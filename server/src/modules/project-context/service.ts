import type {
  ContextAttachment,
  ContextAttachmentSet,
  ContextDocument,
  ContextDocumentContent,
  ContextDocumentIntake,
  ContextOwnerKind,
  ContextSetStatus,
  SpecRead,
} from '@devdigest/shared';
import { CONTEXT_TOKEN_BUDGET } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { MAX_DOCS_PER_REPO } from './constants.js';
import {
  ProjectContextRepository,
  type ContextDocumentSummaryRow,
} from './repository.js';
import {
  type EffectiveEntry,
  classifyDocument,
  deriveHealth,
  fingerprint,
  mergeEffectiveSet,
  renderContextDocument,
  toDocumentDto,
  validateIntake,
} from './helpers.js';

/**
 * Project Context — the use cases.
 *
 * Four of them, and the split between them matters:
 *   - `sync`     reconciles the stored snapshots against a scan of the clone
 *   - intake     accepts a studio-authored document
 *   - attachment reads/writes an owner's ordered set for one repository
 *   - `effectiveSetForRun` resolves what a run actually injects
 *
 * Two rules run through all of it. First, a run reads the STORED snapshot,
 * never the clone: that is what makes a trace reproducible after the clone
 * moves on. Second, a skill contributes WHICH documents an agent reads and
 * never their text — the skills prompt block is injected as trusted
 * instructions, while document bodies must stay inside the untrusted
 * project-context block.
 *
 * The token threshold warns and nothing more. No method here refuses a write
 * or a run because a set is large.
 */
export class ProjectContextService {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    this.repo = new ProjectContextRepository(container.db);
  }

  async listDocuments(workspaceId: string, repoId: string): Promise<ContextDocument[]> {
    const rows = await this.repo.listDocuments(workspaceId, repoId);
    return rows.map((row) => toDocumentDto(row, row.usedByAgents));
  }

  async getDocument(
    workspaceId: string,
    repoId: string,
    docId: string,
  ): Promise<ContextDocumentContent> {
    const row = await this.repo.getDocument(workspaceId, repoId, docId);
    if (!row) throw new NotFoundError('Document not found');
    return { ...toDocumentDto(row, 0), content: row.content };
  }

  /**
   * Rescan the repository's document root and reconcile.
   *
   * `available: false` — no clone, unreadable root — is not treated as "there
   * are no documents": every stored snapshot is left exactly as it was and the
   * state records why, because the alternative is a missing disk silently
   * emptying every agent's attachments.
   *
   * Reconciliation only ever touches `origin: 'repo'` rows. A studio-authored
   * document is never marked missing and never overwritten, including when a
   * discovered file appears at the same path — the upsert's conflict target
   * includes `origin`, which is what makes that coexistence structural rather
   * than a condition somebody has to remember to write.
   */
  async sync(workspaceId: string, repoId: string): Promise<ContextSetStatus> {
    const repoRow = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    const scan = await this.container.docSource.scan({
      owner: repoRow.owner,
      name: repoRow.name,
    });

    if (!scan.available) {
      await this.repo.upsertSyncState({
        repoId,
        lastSyncedSha: null,
        lastSyncedAt: null,
        documentCount: await this.repo.countDocuments(repoId),
        outcome: 'failed',
        reason: 'no_clone',
      });
      return this.status(workspaceId, repoId);
    }

    const seenPaths = new Set<string>();
    for (const file of scan.files) {
      const classified = classifyDocument(file.path);
      if (!classified) continue;
      seenPaths.add(file.path);
      await this.repo.upsertRepoDocument({
        workspaceId,
        repoId,
        path: file.path,
        name: classified.name,
        folder: classified.folder,
        category: classified.category,
        content: file.content,
        sizeBytes: file.sizeBytes,
        tokenCount: this.container.tokenizer.count(file.content),
        fingerprint: fingerprint(file.content),
      });
    }

    const stored = await this.repo.listRepoDocumentPaths(repoId);
    const vanished = stored.filter((row) => !seenPaths.has(row.path)).map((row) => row.id);
    await this.repo.markMissing(repoId, vanished);

    const bounded = scan.bounded > 0;
    await this.repo.upsertSyncState({
      repoId,
      lastSyncedSha: scan.head,
      lastSyncedAt: new Date(),
      documentCount: await this.repo.countDocuments(repoId),
      outcome: bounded ? 'bounded' : 'ok',
      // The count goes in the reason so the footer can say how much was left
      // out, rather than showing a plausible-looking partial list as complete.
      reason: bounded ? `bounded:${scan.bounded}:${MAX_DOCS_PER_REPO}` : null,
    });

    return this.status(workspaceId, repoId);
  }

  async status(workspaceId: string, repoId: string): Promise<ContextSetStatus> {
    const repoRow = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');
    const state = await this.repo.getSyncState(repoId);
    return {
      document_count: state?.documentCount ?? (await this.repo.countDocuments(repoId)),
      last_synced_at: state?.lastSyncedAt ? state.lastSyncedAt.toISOString() : null,
      health: deriveHealth(
        state ? { outcome: state.outcome, lastSyncedAt: state.lastSyncedAt } : null,
        Date.now(),
      ),
      reason: state?.reason ?? null,
    };
  }

  /**
   * Create a studio-authored document. Validation is the helper's, so the same
   * rules apply whether the body was typed in the studio or read out of an
   * uploaded file — upload is the same intake, not a second path.
   */
  async createDocument(
    workspaceId: string,
    repoId: string,
    intake: ContextDocumentIntake,
  ): Promise<ContextDocument> {
    const repoRow = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    const checked = validateIntake(intake);
    if (!checked.ok) throw new ValidationError(checked.reason);

    const row = await this.repo.insertUserDocument({
      workspaceId,
      repoId,
      path: checked.path,
      name: checked.name,
      folder: checked.folder,
      category: intake.category,
      content: intake.body,
      sizeBytes: checked.sizeBytes,
      tokenCount: this.container.tokenizer.count(intake.body),
      fingerprint: fingerprint(intake.body),
    });
    if (!row) {
      throw new ConflictError(`A document already exists at ${checked.path}.`);
    }
    return toDocumentDto(row, 0);
  }

  /**
   * Delete a studio-authored document. A discovered one is refused: deleting
   * the row would not delete the file, so the next sync would bring it straight
   * back — re-syncing after removing the file is the honest way to do it.
   */
  async deleteDocument(workspaceId: string, repoId: string, docId: string): Promise<void> {
    const row = await this.repo.getDocument(workspaceId, repoId, docId);
    if (!row) throw new NotFoundError('Document not found');
    if (row.origin === 'repo') {
      throw new ValidationError(
        'This document was discovered in the repository. Remove the file and re-sync instead.',
      );
    }
    await this.repo.deleteUserDocument(workspaceId, repoId, docId);
  }

  // --------------------------------------------------------- attachments ----

  /**
   * The effective set for one owner in one repository.
   *
   * For an agent that means the merged set — its own attachments plus the ones
   * its ENABLED skills contribute, each marked with how it was reached — so the
   * tab shows what a run would inject rather than only what was clicked here.
   * For a skill it is that skill's own ordered list.
   */
  async attachments(
    kind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
    workspaceId: string,
  ): Promise<ContextAttachmentSet> {
    const repoRow = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    const byId = new Map<string, ContextDocumentSummaryRow>();
    for (const row of await this.repo.listDocuments(workspaceId, repoId)) byId.set(row.id, row);

    const direct = await this.repo.attachedIds(kind, ownerId, repoId);

    let entries: EffectiveEntry[] = direct.map((documentId) => ({
      documentId,
      provenance: 'direct',
    }));
    if (kind === 'agent') {
      const enabledSkillIds = await this.enabledSkillIdsFor(ownerId);
      const bySkill = await this.repo.attachmentsForSkills(enabledSkillIds, repoId);
      entries = mergeEffectiveSet(
        direct,
        enabledSkillIds.map((id) => bySkill.get(id) ?? []),
      );
    }

    const documents: ContextAttachment[] = [];
    let totalTokens = 0;
    for (const entry of entries) {
      const row = byId.get(entry.documentId);
      if (!row) continue;
      documents.push({
        document: toDocumentDto(row, row.usedByAgents),
        provenance: entry.provenance,
      });
      totalTokens += row.tokenCount;
    }

    return {
      repo_id: repoId,
      owner_kind: kind,
      owner_id: ownerId,
      documents,
      total_tokens: totalTokens,
      budget_threshold: CONTEXT_TOKEN_BUDGET,
      // A display signal. Nothing below refuses a write because of it.
      over_budget: totalTokens > CONTEXT_TOKEN_BUDGET,
    };
  }

  /**
   * Replace an owner's whole ordered set. Every id must belong to this
   * repository and workspace; one that does not is a validation error rather
   * than a silently-dropped entry, because a half-applied write is worse than
   * a rejected one.
   */
  async setAttachments(
    kind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
    workspaceId: string,
    documentIds: string[],
  ): Promise<ContextAttachmentSet> {
    const repoRow = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    const unique = [...new Set(documentIds)];
    const owned = new Set(await this.repo.idsInRepo(workspaceId, repoId, unique));
    const foreign = unique.filter((id) => !owned.has(id));
    if (foreign.length > 0) {
      throw new ValidationError(
        `These documents do not belong to this repository: ${foreign.join(', ')}`,
      );
    }

    await this.repo.replaceAttachments(kind, ownerId, repoId, unique);
    return this.attachments(kind, ownerId, repoId, workspaceId);
  }

  // ------------------------------------------------------------ run path ----

  /**
   * What one run injects, and what to record that it read.
   *
   * `enabledSkillIds` is passed IN rather than looked up: the caller already
   * computed which skills are enabled and in what order to build the skills
   * prompt block, and the two must not be able to disagree about which skills
   * are on.
   *
   * Bodies come from the stored snapshots. A document flagged `missing` is
   * skipped but still reported, with `status: 'missing'`, so the trace can say
   * "this was attached and was not injected" instead of leaving it looking as
   * though it was never attached. An empty set returns empty arrays — that is a
   * normal run, not a failure.
   */
  async effectiveSetForRun(
    workspaceId: string,
    repoId: string,
    agentId: string,
    enabledSkillIds: string[],
  ): Promise<{ texts: string[]; read: SpecRead[] }> {
    const direct = await this.repo.attachedIds('agent', agentId, repoId);
    const bySkill = await this.repo.attachmentsForSkills(enabledSkillIds, repoId);
    const entries = mergeEffectiveSet(
      direct,
      enabledSkillIds.map((id) => bySkill.get(id) ?? []),
    );
    if (entries.length === 0) return { texts: [], read: [] };

    const rows = await this.repo.documentsByIds(
      workspaceId,
      repoId,
      entries.map((e) => e.documentId),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));

    const texts: string[] = [];
    const read: SpecRead[] = [];
    for (const entry of entries) {
      const row = byId.get(entry.documentId);
      if (!row) continue;
      if (row.availability === 'missing') {
        read.push({ path: row.path, origin: row.origin, status: 'missing' });
        continue;
      }
      texts.push(renderContextDocument({ path: row.path, content: row.content }));
      read.push({ path: row.path, origin: row.origin, status: 'injected' });
    }
    return { texts, read };
  }

  /**
   * The agent's enabled skill ids, in the user's configured order — the same
   * ordering rule the prompt's skills block uses (sort first, then drop the
   * disabled, so dropping one leaves the survivors' relative order alone).
   */
  private async enabledSkillIdsFor(agentId: string): Promise<string[]> {
    const links = await this.container.agentsRepo.linkedSkills(agentId);
    return [...links]
      .sort((a, b) => a.order - b.order)
      .filter((l) => l.skill.enabled)
      .map((l) => l.skill.id);
  }
}
