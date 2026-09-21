import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow, FindingRow } from '../../db/rows.js';
export type { PullRow, FindingRow };

export type PrFileRow = typeof t.prFiles.$inferSelect;
export type PrCommitRow = typeof t.prCommits.$inferSelect;

/** One PR as reported by GitHub's list/detail endpoints — the shape
 *  `upsertPullRequests` batches into one statement. */
export interface PrSync {
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  head_sha: string;
  additions: number;
  deletions: number;
  files_count: number;
  status: string;
  opened_at?: string | null;
  updated_at?: string | null;
}

export interface ReviewScoreRow {
  id: string;
  prId: string;
  score: number | null;
  agentId: string | null;
}

export interface RunCostRow {
  prId: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

/**
 * F1 — pulls data-access layer. The ONLY place that touches `pull_requests`,
 * `pr_files` and `pr_commits`. `reviews`/`agent_runs` reads here are narrow,
 * read-only projections for the PR-list rollup (score/findings/cost) — the
 * tables themselves stay owned by the reviews module.
 */
export class PullsRepository {
  constructor(private db: Db) {}

  async getInWorkspace(workspaceId: string, id: string): Promise<PullRow | undefined> {
    const [pr] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    return pr;
  }

  async listForRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  /**
   * Bulk upsert — one statement for N PRs (was one `insert` per PR; the N+1
   * write loop the onion-architecture debt list flagged). `sql`excluded...``
   * lets each row keep its own conflict-update values in a single batch insert.
   */
  async upsertPullRequests(workspaceId: string, repoId: string, pulls: PrSync[]): Promise<void> {
    if (pulls.length === 0) return;
    await this.db
      .insert(t.pullRequests)
      .values(
        pulls.map((pr) => ({
          workspaceId,
          repoId,
          number: pr.number,
          title: pr.title,
          author: pr.author,
          branch: pr.branch,
          base: pr.base,
          headSha: pr.head_sha,
          additions: pr.additions,
          deletions: pr.deletions,
          filesCount: pr.files_count,
          status: pr.status,
          openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
          updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
        })),
      )
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: sql`excluded.title`,
          headSha: sql`excluded.head_sha`,
          status: sql`excluded.status`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  /** Backfill diff stats for one PR (GitHub's list payload omits them). */
  async updateDiffStats(
    id: string,
    stats: { additions: number; deletions: number; filesCount: number },
  ): Promise<void> {
    await this.db
      .update(t.pullRequests)
      .set(stats)
      .where(eq(t.pullRequests.id, id));
  }

  /** Latest review (by createdAt) per PR — newest first, so the caller keeps
   *  only the first row seen per `prId` / per `prId::agentId` pair. */
  async latestReviewsForPrs(prIds: string[]): Promise<ReviewScoreRow[]> {
    if (prIds.length === 0) return [];
    return this.db
      .select({
        id: t.reviews.id,
        prId: t.reviews.prId,
        score: t.reviews.score,
        agentId: t.reviews.agentId,
      })
      .from(t.reviews)
      .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));
  }

  async findingsForReviews(reviewIds: string[]): Promise<FindingRow[]> {
    if (reviewIds.length === 0) return [];
    return this.db.select().from(t.findings).where(inArray(t.findings.reviewId, reviewIds));
  }

  async successfulRunCostsForPrs(workspaceId: string, prIds: string[]): Promise<RunCostRow[]> {
    if (prIds.length === 0) return [];
    return this.db
      .select({
        prId: t.agentRuns.prId,
        model: t.agentRuns.model,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        costUsd: t.agentRuns.costUsd,
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          inArray(t.agentRuns.prId, prIds),
          eq(t.agentRuns.status, 'done'),
        ),
      );
  }

  async getPrFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  async getPrCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  /**
   * Replace a PR's files/commits with a fresh GitHub detail fetch, and update
   * its body + diff stats — one transaction, so a mid-refresh failure can't
   * leave the PR with its old body but no files (or vice versa).
   */
  async replaceDetail(
    prId: string,
    detail: {
      body: string | null;
      additions: number;
      deletions: number;
      filesCount: number;
      files: { path: string; additions: number; deletions: number; patch: string | null }[];
      commits: { sha: string; message: string; author: string; committedAt: Date | null }[];
    },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      if (detail.files.length > 0) {
        await tx.insert(t.prFiles).values(detail.files.map((f) => ({ prId, ...f })));
      }
      await tx.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
      if (detail.commits.length > 0) {
        await tx.insert(t.prCommits).values(detail.commits.map((c) => ({ prId, ...c })));
      }
      await tx
        .update(t.pullRequests)
        .set({
          body: detail.body,
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.filesCount,
        })
        .where(eq(t.pullRequests.id, prId));
    });
  }
}
