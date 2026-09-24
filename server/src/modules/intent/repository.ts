import { asc, eq, and } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow, RepoRow } from '../../db/rows.js';

/**
 * Intent data-access — the ONLY layer touching the DB for this module, and the
 * single owner of the `pr_intent` table (the dead scaffolding that used to sit
 * on `ReviewRepository` was removed when this landed, so there is exactly one
 * writer).
 *
 * Reads are workspace-scoped through the pull request, which carries
 * `workspace_id`; the per-PR collectors below are all keyed by a `pr_id` the
 * caller has already resolved inside a workspace.
 */

export type PrIntentRow = typeof t.prIntent.$inferSelect;

/** Everything `upsertIntent` persists. `prId` is the key, so it is separate. */
export interface IntentWrite {
  intent: string;
  inScope: string[];
  outOfScope: string[];
  confidence: number;
  riskAreas: { label: string; evidence_path: string | null }[];
  sources: string[];
  provider: string | null;
  model: string | null;
  headSha: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

export class IntentRepository {
  constructor(private db: Db) {}

  async getIntent(prId: string): Promise<PrIntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row;
  }

  /**
   * One row per PR, replaced in place on re-derivation — the row IS the cache,
   * keyed by `pr_id` and invalidated by `head_sha`, so there is no history to
   * keep and nothing to garbage-collect. `derived_at` is bumped explicitly
   * because the column default only applies on insert.
   */
  async upsertIntent(prId: string, values: IntentWrite): Promise<PrIntentRow> {
    const row = { prId, ...values, derivedAt: new Date() };
    const [saved] = await this.db
      .insert(t.prIntent)
      .values(row)
      .onConflictDoUpdate({ target: t.prIntent.prId, set: { ...values, derivedAt: new Date() } })
      .returning();
    return saved!;
  }

  /** The PR and its repo in one workspace-scoped lookup (both or neither). */
  async getPullWithRepo(
    workspaceId: string,
    prId: string,
  ): Promise<{ pull: PullRow; repo: RepoRow } | undefined> {
    const [row] = await this.db
      .select({ pull: t.pullRequests, repo: t.repos })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /** Commit subjects oldest-first — the order they tell the story of the PR in. */
  async getCommitMessages(prId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ message: t.prCommits.message })
      .from(t.prCommits)
      .where(eq(t.prCommits.prId, prId))
      .orderBy(asc(t.prCommits.committedAt))
      .limit(limit);
    return rows.map((r) => r.message);
  }

  /** Changed paths — also the allowlist a proposed risk's citation is checked against. */
  async getChangedPaths(prId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path))
      .limit(limit);
    return rows.map((r) => r.path);
  }
}
