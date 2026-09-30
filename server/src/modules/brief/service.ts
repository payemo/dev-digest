import {
  PrBriefModelOutput,
  PrBriefStored,
  type BlastRadiusResponse,
  type PrBriefRecord,
  type PrIntentRecord,
  type SmartDiffRole,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { loadPromptTemplate } from '../../platform/prompts.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { classifyFile } from '../smart-diff/helpers.js';
import { BriefRepository } from './repository.js';
import { buildBriefMessages, type BriefFacts, type BriefFileFact } from './prompt.js';
import {
  blastSnapshot,
  buildAnchorIndex,
  changedRanges,
  clampSummary,
  inputStatuses,
  intentSnapshot,
  postValidate,
  toRecord,
  toStored,
} from './helpers.js';
import {
  BRIEF_SCHEMA_NAME,
  BRIEF_SYSTEM_PROMPT_FILE,
  BRIEF_TEMPERATURE,
  BRIEF_TIMEOUT_MS,
  OUTPUT_MAX_TOKENS,
} from './constants.js';

/**
 * The logger the brief writes to. Structural on purpose: the route passes its
 * request logger, which satisfies this shape without the service naming the
 * HTTP framework.
 */
export interface BriefLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * PR Brief (L05) — read and generate.
 *
 * COLLECT → PROPOSE → VERIFY, like intent: code gathers precomputed facts
 * (intent, blast, per-file role + changed line ranges, description, linked
 * issue, attached specs), ONE structured model call proposes a summary, risks
 * and review focus, and code verifies every cited path and line against the
 * PR's real files and blast map before anything is stored.
 *
 * Other modules are reached only through their Container getters. Review
 * findings never reach this service, so they cannot reach the prompt.
 */
export class BriefService {
  private repo: BriefRepository;

  /** `workspaceId:prId` currently generating — a double-click must not pay twice.
   *  Process-local, the same accepted limit as intent's guard. */
  private generating = new Set<string>();

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /** The stored brief with `is_stale` derived, or `null`. No model, no GitHub. */
  async get(workspaceId: string, prId: string, log: BriefLog): Promise<PrBriefRecord | null> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const raw = await this.repo.getBrief(prId);
    if (raw === undefined) return null;
    const parsed = PrBriefStored.safeParse(raw);
    if (!parsed.success) {
      // A corrupt or old-shaped row must never break the Overview: treat it as
      // "no brief yet" so the user can simply regenerate.
      log.warn({ prId, issues: parsed.error.issues.length }, 'brief: stored row failed to parse; ignoring');
      return null;
    }
    return toRecord(parsed.data, pull.headSha);
  }

  /**
   * Generate now and persist. One paid model call. A failure anywhere before
   * the upsert leaves the previous brief untouched.
   */
  async generate(workspaceId: string, prId: string, log: BriefLog): Promise<PrBriefRecord> {
    const key = `${workspaceId}:${prId}`;
    if (this.generating.has(key)) {
      throw new ConflictError('A brief is already being generated for this pull request');
    }
    this.generating.add(key);
    try {
      const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
      if (!pull) throw new NotFoundError('Pull request not found');
      const repo = await this.container.reviewRepo.getRepo(pull.repoId);
      if (!repo) throw new NotFoundError('Repository not found');
      const prFiles = await this.container.reviewRepo.getPrFiles(prId);
      if (prFiles.length === 0) {
        throw new ValidationError(
          'This pull request has no changed files on record yet — nothing to brief.',
        );
      }

      // COLLECT — every fallible source degrades to "missing" on its own.
      let intent: PrIntentRecord | null = null;
      try {
        intent = await this.container.intent.get(workspaceId, prId);
      } catch (err) {
        log.info({ prId, err: (err as Error).message }, 'brief: intent unavailable');
      }
      let blast: BlastRadiusResponse | null = null;
      try {
        blast = await this.container.blast.forPull(workspaceId, prId);
      } catch (err) {
        log.info({ prId, err: (err as Error).message }, 'brief: blast radius unavailable');
      }
      let issue: { title: string; body: string | null } | null = null;
      try {
        const linked = await this.container.intent.readLinkedIssue(
          { owner: repo.owner, name: repo.name },
          pull.body,
        );
        issue = linked ? { title: linked.title, body: linked.body } : null;
      } catch (err) {
        log.info({ prId, err: (err as Error).message }, 'brief: linked issue unavailable');
      }
      let specs: { path: string; content: string }[] = [];
      try {
        specs = await this.container.projectContext.specsForBrief(workspaceId, pull.repoId);
      } catch (err) {
        log.info({ prId, err: (err as Error).message }, 'brief: project context unavailable');
      }

      const files: BriefFileFact[] = prFiles.map((f) => ({
        path: f.path,
        role: classifyFile(f.path),
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        ranges: changedRanges(f.patch),
      }));
      const roleCounts: Record<SmartDiffRole, number> = {
        core: 0,
        tests: 0,
        wiring: 0,
        docs: 0,
        boilerplate: 0,
      };
      for (const f of files) roleCounts[f.role]++;

      const inputs = inputStatuses({
        intent,
        blast,
        description: pull.body,
        linkedIssue: issue,
        specsCount: specs.length,
      });
      const intentSnap = intentSnapshot(intent);
      const blastSnap = blastSnapshot(blast);

      const facts: BriefFacts = {
        title: pull.title,
        intent: intent
          ? {
              sentence: intent.intent,
              inScope: intent.in_scope,
              outOfScope: intent.out_of_scope,
              riskAreas: intent.risk_areas.map((r) => ({
                label: r.label,
                path: r.evidence_path ?? null,
              })),
            }
          : null,
        blast: blastSnap
          ? {
              summary: blastSnap.summary,
              degraded: inputs.blast === 'partial',
              symbols: blastSnap.changed_symbols,
              downstream: blastSnap.downstream,
            }
          : null,
        files,
        totals: {
          files: files.length,
          additions: files.reduce((n, f) => n + f.additions, 0),
          deletions: files.reduce((n, f) => n + f.deletions, 0),
        },
        roleCounts,
        description: pull.body,
        issue,
        specs: specs.map((s) => ({ path: s.path, content: s.content })),
        inputs,
      };

      // PROPOSE — exactly one structured call.
      const choice = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
      const llm = await this.container.llm(choice.provider);
      const system = await loadPromptTemplate(BRIEF_SYSTEM_PROMPT_FILE);
      const { messages, inputTokens, truncatedSections } = buildBriefMessages(
        facts,
        (s) => this.container.tokenizer.count(s),
        system,
      );
      const result = await llm.completeStructured({
        model: choice.model,
        schema: PrBriefModelOutput,
        schemaName: BRIEF_SCHEMA_NAME,
        messages,
        temperature: BRIEF_TEMPERATURE,
        maxTokens: OUTPUT_MAX_TOKENS,
        timeoutMs: BRIEF_TIMEOUT_MS,
      });

      // VERIFY — only real paths and known lines survive.
      const anchors = buildAnchorIndex(files, blastSnap);
      const verified = postValidate(result.data, anchors);

      const stored = toStored({
        prId,
        headSha: pull.headSha,
        generatedAt: new Date().toISOString(),
        summary: clampSummary(result.data.summary),
        intent: intentSnap,
        blast: blastSnap,
        risks: verified.risks,
        reviewFocus: verified.review_focus,
        provider: choice.provider,
        model: result.model,
        attempts: result.attempts,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        inputTokensMeasured: inputTokens,
        truncatedSections,
        inputs,
        validation: verified.validation,
      });
      await this.repo.upsertBrief(prId, stored);

      log.info(
        {
          prId,
          provider: choice.provider,
          model: result.model,
          attempts: result.attempts,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
          inputTokensMeasured: inputTokens,
          truncatedSections,
          validation: verified.validation,
        },
        'brief: generated',
      );
      return toRecord(stored, pull.headSha);
    } finally {
      this.generating.delete(key);
    }
  }
}
