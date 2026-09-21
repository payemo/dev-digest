import type { RepoRef } from '@devdigest/shared';
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillCreate,
  ConventionSkillDraft,
  ConventionUpdate,
  Skill,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { ConventionsRepository } from './repository.js';
import {
  buildSkillDraft,
  dedupeCandidates,
  renderSamples,
  ruleKey,
  toCandidateDto,
  toSampledFile,
  verifyCandidate,
  type DropReason,
  type SampledFile,
  type VerifiedCandidate,
} from './helpers.js';
import { ExtractionSchema, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import {
  CONFIG_SAMPLE_PATHS,
  CONVENTIONS_SKILL_NAME,
  EXTRACT_MAX_TOKENS,
  EXTRACT_TEMPERATURE,
  EXTRACT_TIMEOUT_MS,
  MAX_SAMPLE_CHARS,
  TOP_CODE_SAMPLES,
} from './constants.js';

/**
 * Conventions Extractor.
 *
 * Three stages, and only the middle one is a model:
 *   1. SAMPLE  — code picks the files (configs + repo-intel's top-ranked
 *                source files). The model never browses the repo.
 *   2. PROPOSE — one cheap structured call over that sample. Candidates are
 *                proposals with a citation, nothing more.
 *   3. VERIFY  — code re-reads the cited file and drops any candidate whose
 *                snippet is not really there (see helpers.verifyCandidate).
 *
 * What survives is persisted as `pending` for the user to accept or reject;
 * approved rules are assembled into a `repo-conventions` skill via the Skills
 * module — this service never writes to the `skills` table itself.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  /** repoId currently mid-scan, so a double-click (or two tabs) can't fire two model calls for the same repo. */
  private scanning = new Set<string>();

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listForRepo(workspaceId, repoId);
    return rows.map(toCandidateDto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: ConventionUpdate,
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toCandidateDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Run a scan and replace this repo's pending candidates with the result. */
  async extract(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const scanKey = `${workspaceId}:${repoId}`;
    if (this.scanning.has(scanKey)) {
      throw new ConflictError('A scan for this repository is already running');
    }
    this.scanning.add(scanKey);
    try {
      const repo = await this.container.reposRepo.getById(workspaceId, repoId);
      if (!repo) throw new NotFoundError('Repository not found');
      const ref: RepoRef = { owner: repo.owner, name: repo.name };

      const files = await this.sample(repoId, ref);
      if (files.length === 0) {
        throw new ValidationError(
          'Nothing to sample — the repository has not been cloned and indexed yet. Open it once so repo-intel can index it, then re-run the scan.',
        );
      }

      const byPath = new Map(files.map((f) => [f.path, f]));
      const sampledPaths = files.map((f) => f.path);
      const rendered = renderSamples(files, MAX_SAMPLE_CHARS);

      const choice = await resolveFeatureModel(this.container, workspaceId, 'conventions');
      const llm = await this.container.llm(choice.provider);
      const result = await llm.completeStructured({
        model: choice.model,
        schema: ExtractionSchema,
        // Matches the fixture key `MockLLMOptions.structuredBySchema` documents
        // for this feature, so a test can target this call by name.
        schemaName: 'ConventionExtraction',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(repo.fullName, rendered, sampledPaths) },
        ],
        temperature: EXTRACT_TEMPERATURE,
        maxTokens: EXTRACT_MAX_TOKENS,
        timeoutMs: EXTRACT_TIMEOUT_MS,
      });

      const proposed = result.data.candidates;
      const verified: VerifiedCandidate[] = [];
      const drops: DropReason[] = [];
      for (const raw of proposed) {
        const check = verifyCandidate(byPath, raw);
        if (check.ok) verified.push(check.candidate);
        else drops.push(check.reason);
      }
      verified.sort((a, b) => b.confidence - a.confidence);

      // Rules the user already ruled on stay ruled on: a re-scan must not
      // re-propose something approved (it may already be in a skill) or rejected.
      const existing = await this.repo.listForRepo(workspaceId, repoId);
      const decided = existing.filter((r) => r.status !== 'pending').map((r) => ruleKey(r));
      const { kept, dropped: duplicates } = dedupeCandidates(verified, decided);

      await this.repo.replacePending(workspaceId, repoId, kept);
      // Return the whole board, not just the new rows: the page renders
      // approved and rejected candidates from earlier scans alongside these.
      const all = await this.repo.listForRepo(workspaceId, repoId);

      return {
        candidates: all.map(toCandidateDto),
        sampled_files: sampledPaths,
        proposed: proposed.length,
        dropped_ungrounded: drops.length,
        dropped_duplicate: duplicates,
        model: result.model,
        cost_usd: result.costUsd,
      };
    } finally {
      this.scanning.delete(scanKey);
    }
  }

  /**
   * Build a skill draft from the currently APPROVED candidates. Persists
   * NOTHING — the client edits the draft and POSTs it to the create endpoint,
   * the same preview-then-confirm flow the Skills import path uses.
   */
  async skillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const rows = await this.repo.listApprovedForRepo(workspaceId, repoId);
    if (rows.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill');
    }
    const existing = await this.container.skills.getByName(workspaceId, CONVENTIONS_SKILL_NAME);
    return buildSkillDraft(rows, {
      name: CONVENTIONS_SKILL_NAME,
      existingSkillId: existing?.id ?? null,
    });
  }

  /**
   * Create (or, with explicit confirmation, replace) the `repo-conventions`
   * skill from the user's edited draft — through `container.skills`, never
   * around it, so versioning and the enabled-on-create gate stay intact.
   */
  async createSkill(
    workspaceId: string,
    repoId: string,
    input: ConventionSkillCreate,
  ): Promise<Skill> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const rows = await this.repo.listByIds(workspaceId, input.convention_ids);
    const approvedCount = rows.filter((r) => r.status === 'approved').length;
    if (approvedCount === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill');
    }

    const existing = await this.container.skills.getByName(workspaceId, input.name);
    if (existing && existing.id !== input.replace_skill_id) {
      throw new ConflictError(
        `A skill named "${input.name}" already exists. Confirm replacing it, or choose a different name.`,
        { existing_skill_id: existing.id },
      );
    }

    const requestedEnabled = input.enabled ?? true;

    if (existing) {
      // `update` has no enabled-on-create gate — replacing an EXISTING skill
      // is a human editing its toggle, which is always allowed in one call.
      const updated = await this.container.skills.update(workspaceId, existing.id, {
        description: input.description,
        type: input.type,
        body: input.body,
        enabled: requestedEnabled,
      });
      if (!updated) throw new NotFoundError('Skill not found');
      return updated;
    }

    // `SkillCreate.enabled` is IGNORED for any source other than 'manual' (see
    // `mayBeEnabledOnCreate` — the skill body reaches the model as trusted
    // instructions, not delimiter-wrapped data, so a non-typed body always
    // lands disabled). We create as 'extracted' and, only when the user left
    // the modal's toggle on, follow up with an explicit `update` — the human
    // enabling it IS that toggle, on a body they just read and edited.
    const created = await this.container.skills.create(workspaceId, {
      name: input.name,
      description: input.description,
      type: input.type,
      source: 'extracted',
      body: input.body,
      evidence_files: rows
        .filter((r) => r.status === 'approved' && r.evidencePath)
        .map((r) => r.evidencePath as string),
    });
    if (!requestedEnabled) return created;
    return (await this.container.skills.update(workspaceId, created.id, { enabled: true })) ?? created;
  }

  /**
   * Stage 1 — pick and read the sample, entirely in code.
   *
   * Configs come first (they state conventions outright and are cheap), then
   * repo-intel's top-ranked source files, which already exclude tests, configs
   * and migrations. A file that cannot be read is skipped rather than fatal:
   * `CONFIG_SAMPLE_PATHS` is a wish-list, and most repos have only a few of them.
   */
  private async sample(repoId: string, ref: RepoRef): Promise<SampledFile[]> {
    const codePaths = await this.container.repoIntel
      .getConventionSamples(repoId, TOP_CODE_SAMPLES)
      .catch(() => [] as string[]);
    const paths = [...CONFIG_SAMPLE_PATHS, ...codePaths];

    const files: SampledFile[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      let raw: string;
      try {
        raw = await this.container.git.readFile(ref, path);
      } catch {
        continue; // not in this repo (config wish-list) or unreadable — skip
      }
      if (!raw.trim()) continue;
      files.push(toSampledFile(path, raw));
    }
    return files;
  }
}
