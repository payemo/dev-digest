import type { PrIntentRecord, RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import type { RunLogger } from '../../platform/run-logger.js';
import { loadPromptTemplate } from '../../platform/prompts.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { IntentRepository, type PrIntentRow } from './repository.js';
import { PrIntentSchema, buildUserPrompt } from './prompt.js';
import {
  branchIsDescriptive,
  confidenceBand,
  deriveConfidence,
  extractLinkedIssueRefs,
  extractSpecPaths,
  extractTicketKeys,
  hasRealDocumentation,
  isSafeSpecPath,
  meaningfulCommitMessages,
  verifyRiskAreas,
  type IntentSignals,
} from './helpers.js';
import {
  INTENT_MAX_TOKENS,
  INTENT_SCHEMA_NAME,
  INTENT_SYSTEM_PROMPT_FILE,
  INTENT_TEMPERATURE,
  INTENT_TIMEOUT_MS,
  MAX_COMMIT_MESSAGES,
  MAX_PATHS,
  MAX_SPEC_FILES,
  MIN_MEANINGFUL_COMMITS,
} from './constants.js';

/**
 * Intent derivation (L03).
 *
 * Three stages, and only the middle one is a model — the same COLLECT →
 * PROPOSE → VERIFY shape the conventions extractor uses:
 *   1. COLLECT  — code gathers the evidence, in a fixed precedence: referenced
 *                 plan/spec files, then the linked issue, then the PR body,
 *                 then title / commits / branch / changed paths. The model
 *                 never browses the repo and never picks what it reads.
 *   2. PROPOSE  — ONE cheap structured call over that evidence.
 *   3. VERIFY   — code checks each proposed risk area's cited path against the
 *                 PR's real changed files, and computes the CONFIDENCE itself
 *                 from which evidence was present. The model is never asked to
 *                 score itself.
 *
 * Derivation is BEST-EFFORT on the review path: `ensureForRun` catches
 * everything and degrades to a Live Log `info` line, exactly like the callers
 * digest and the repo map. It must never reach the `failAll` path in
 * `run-executor.ts`, which is reserved for diff loading.
 */
export class IntentService {
  private repo: IntentRepository;

  /** `workspaceId:prId` currently mid-derivation, so a double-click (or a run
   *  racing a manual re-derive) cannot fire two paid model calls for one PR. */
  private deriving = new Set<string>();

  constructor(private container: Container) {
    this.repo = new IntentRepository(container.db);
  }

  /** The persisted record, with `is_stale` computed against the PR's head. */
  async get(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    const found = await this.repo.getPullWithRepo(workspaceId, prId);
    if (!found) throw new NotFoundError('Pull request not found');
    const row = await this.repo.getIntent(prId);
    return row ? toDto(row, found.pull.headSha) : null;
  }

  /**
   * Derive now and persist. Throws on a real failure (missing PR, nothing to
   * derive from, a provider error) — the manual `POST` surfaces that to the
   * user, while `ensureForRun` swallows it.
   */
  async derive(workspaceId: string, prId: string, log?: RunLogger): Promise<PrIntentRecord> {
    const key = `${workspaceId}:${prId}`;
    if (this.deriving.has(key)) {
      throw new ConflictError('Intent for this pull request is already being derived');
    }
    this.deriving.add(key);
    try {
      const found = await this.repo.getPullWithRepo(workspaceId, prId);
      if (!found) throw new NotFoundError('Pull request not found');
      const { pull, repo } = found;

      const signals = await this.collect(pull, repo, log);
      if (signals.paths.length === 0) {
        // D1's floor: with zero changed files there is nothing to derive from,
        // so we write no row rather than persist a guess.
        throw new ValidationError(
          'This pull request has no changed files on record yet — nothing to derive an intent from.',
        );
      }

      const sources = collectSources(signals, pull);
      const confidence = deriveConfidence(sources);

      const choice = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
      const llm = await this.container.llm(choice.provider);
      const system = await loadPromptTemplate(INTENT_SYSTEM_PROMPT_FILE);
      const result = await llm.completeStructured({
        model: choice.model,
        schema: PrIntentSchema,
        // Matches the fixture key `MockLLMOptions.structuredBySchema` uses, so
        // a test can target this call by name.
        schemaName: INTENT_SCHEMA_NAME,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: buildUserPrompt(repo.fullName, pull.number, signals) },
        ],
        temperature: INTENT_TEMPERATURE,
        maxTokens: INTENT_MAX_TOKENS,
        timeoutMs: INTENT_TIMEOUT_MS,
      });

      const risks = verifyRiskAreas(result.data.risk_areas, signals.paths);
      if (risks.dropped > 0) {
        log?.info(
          `intent: dropped ${risks.dropped} risk area(s) citing a path this PR does not change`,
        );
      }

      const row = await this.repo.upsertIntent(prId, {
        intent: result.data.intent,
        inScope: result.data.in_scope,
        outOfScope: result.data.out_of_scope,
        confidence,
        riskAreas: risks.kept.map((r) => ({ label: r.label, evidence_path: r.evidence_path ?? null })),
        sources,
        provider: choice.provider,
        model: result.model,
        headSha: pull.headSha,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      });

      log?.info(
        `intent: sources=[${sources.join(', ')}], confidence=${confidence.toFixed(2)} ` +
          `(${confidenceBand(confidence)}), model=${result.model}, cost=${formatCost(result.costUsd)}`,
      );
      return toDto(row, pull.headSha);
    } finally {
      this.deriving.delete(key);
    }
  }

  /**
   * The review path's entry point. Returns the cached row when it was derived
   * against this same head SHA, otherwise re-derives.
   *
   * NEVER throws and never rejects: a failed derivation emits one `info` line
   * and resolves to the stale row if there is one (a stale intent beats none),
   * else `undefined` — and the review runs with the prompt it would have had
   * before this feature existed.
   */
  async ensureForRun(
    workspaceId: string,
    pull: PullRow,
    _repo: RepoRow,
    runLog: RunLogger,
  ): Promise<PrIntentRecord | undefined> {
    let cached: PrIntentRow | undefined;
    try {
      cached = await this.repo.getIntent(pull.id);
      if (cached && cached.headSha === pull.headSha) {
        runLog.info(
          `intent: reusing cached derivation for ${pull.headSha.slice(0, 7)} ` +
            `(confidence=${cached.confidence.toFixed(2)} ${confidenceBand(cached.confidence)}, no model call)`,
        );
        return toDto(cached, pull.headSha);
      }
      return await this.derive(workspaceId, pull.id, runLog);
    } catch (err) {
      runLog.info(
        `intent: derivation failed — ${(err as Error).message}; continuing without intent`,
      );
      if (cached) {
        runLog.info('intent: falling back to the previous (stale) derivation');
        return toDto(cached, pull.headSha);
      }
      return undefined;
    }
  }

  /**
   * Stage 1 — gather the evidence, entirely in code.
   *
   * Both external reads degrade instead of failing: no GitHub token (or an
   * offline box) drops the issue source, and an un-cloned repo drops the spec
   * source. Each simply lowers the computed confidence, which is the point of
   * computing it from evidence in the first place.
   */
  private async collect(pull: PullRow, repo: RepoRow, log?: RunLogger): Promise<IntentSignals> {
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const [rawCommits, paths] = await Promise.all([
      this.repo.getCommitMessages(pull.id, MAX_COMMIT_MESSAGES * 2),
      this.repo.getChangedPaths(pull.id, MAX_PATHS),
    ]);

    return {
      title: pull.title,
      branch: pull.branch,
      base: pull.base,
      body: pull.body,
      issue: await this.readLinkedIssue(ref, pull.body, log),
      specs: await this.readSpecs(ref, pull.body, log),
      commits: meaningfulCommitMessages(rawCommits),
      paths,
      additions: pull.additions,
      deletions: pull.deletions,
      filesCount: pull.filesCount,
      ticketKeys: extractTicketKeys(pull.body),
    };
  }

  /** Tier 2 — the first closing-keyword reference, resolved over REST. */
  private async readLinkedIssue(
    ref: RepoRef,
    body: string | null,
    log?: RunLogger,
  ): Promise<IntentSignals['issue']> {
    const [linked] = extractLinkedIssueRefs(body);
    if (!linked) return null;
    const target: RepoRef =
      linked.owner && linked.repo ? { owner: linked.owner, name: linked.repo } : ref;
    try {
      const github = await this.container.github();
      const issue = await github.getIssue(target, linked.number);
      return { number: issue.number, title: issue.title, body: issue.body ?? null };
    } catch (err) {
      // No token / offline / private issue — mirrors how PR detail degrades.
      log?.info(`intent: linked issue #${linked.number} unreadable — ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Tier 1 — referenced plan/spec files, read off the clone.
   *
   * `isSafeSpecPath` is applied a SECOND time here, at the point of use, even
   * though `extractSpecPaths` already filtered: `GitClient.readFile` joins the
   * path straight onto the clone directory with no traversal guard of its own,
   * so the check belongs next to the call it protects.
   */
  private async readSpecs(
    ref: RepoRef,
    body: string | null,
    log?: RunLogger,
  ): Promise<IntentSignals['specs']> {
    const candidates = extractSpecPaths(body).slice(0, MAX_SPEC_FILES);
    const specs: IntentSignals['specs'] = [];
    for (const path of candidates) {
      if (!isSafeSpecPath(path)) continue;
      try {
        const content = await this.container.git.readFile(ref, path);
        if (content.trim()) specs.push({ path, content });
      } catch {
        // Not cloned, or the file does not exist on this ref — skip it.
        log?.info(`intent: referenced spec ${path} not readable — skipped`);
      }
    }
    return specs;
  }
}

/**
 * The evidence markers that feed D3's weights. This is the audit trail for the
 * confidence number: every marker here is something we actually read, and
 * `ticket_ref_unreadable` is recorded precisely because it is NOT evidence —
 * it explains a low score on a PR that looks well-referenced.
 */
function collectSources(signals: IntentSignals, pull: PullRow): string[] {
  const sources: string[] = [];
  for (const spec of signals.specs) sources.push(`spec:${spec.path}`);
  if (signals.issue?.body?.trim()) sources.push(`issue:${signals.issue.number}`);
  if (hasRealDocumentation(pull.body)) sources.push('body');
  if (signals.commits.length >= MIN_MEANINGFUL_COMMITS) sources.push('commits');
  if (branchIsDescriptive(pull.branch)) sources.push('branch');
  if (signals.paths.length > 0) sources.push('paths');
  if (signals.ticketKeys.length > 0) sources.push('ticket_ref_unreadable');
  return sources;
}

/** Row → wire DTO. `is_stale` is derived on read, never stored. */
function toDto(row: PrIntentRow, currentHeadSha: string): PrIntentRecord {
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    risk_areas: row.riskAreas,
    sources: row.sources,
    provider: row.provider,
    model: row.model,
    derived_at: row.derivedAt.toISOString(),
    head_sha: row.headSha,
    is_stale: row.headSha !== currentHeadSha,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
  };
}

function formatCost(costUsd: number | null): string {
  return costUsd == null ? 'n/a' : `$${costUsd.toFixed(4)}`;
}
