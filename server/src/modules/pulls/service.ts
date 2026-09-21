import type { Container } from '../../platform/container.js';
import type {
  PrMeta,
  PrDetail,
  GitHubClient,
  PrReviewComment,
  PrCommentInput,
  Finding,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { RepoRow } from '../../db/rows.js';
import { findingRowToDto } from '../reviews/helpers.js';
import { deriveReviewStatus } from './status.js';
import { sumRunCosts, type Estimator } from '../../platform/run-cost.js';
import { PullsRepository, type PullRow } from './repository.js';

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export interface Logger {
  warn: (obj: unknown, msg?: string) => void;
}

const BACKFILL_LIMIT = 10;

/**
 * F1 — pulls service. Orchestrates the GitHub client + `PullsRepository`;
 * owns the score/findings/cost aggregation that used to live inline in
 * routes.ts (onion-architecture debt list, `pulls` entry).
 */
export class PullsService {
  private repo: PullsRepository;

  constructor(private container: Container) {
    this.repo = new PullsRepository(container.db);
  }

  private async githubOrNull(logger: Logger | undefined, context: string): Promise<GitHubClient | null> {
    try {
      return await this.container.github();
    } catch (err) {
      logger?.warn({ err }, `GitHub client unavailable (no token / offline); ${context}`);
      return null;
    }
  }

  private async requireRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  private async requirePull(workspaceId: string, id: string): Promise<{ pull: PullRow; repo: RepoRow }> {
    const pull = await this.repo.getInWorkspace(workspaceId, id);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.container.reposRepo.getById(workspaceId, pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pull, repo };
  }

  // ===========================================================================
  // List — sync from GitHub (best-effort), then roll up score/findings/cost.
  // ===========================================================================

  async listForRepo(workspaceId: string, repoId: string, logger?: Logger): Promise<PrMeta[]> {
    const repoRow = await this.requireRepo(workspaceId, repoId);
    const gh = await this.githubOrNull(logger, 'serving persisted PRs');

    // Local-first: sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repoRow.owner, name: repoRow.name });
        await this.repo.upsertPullRequests(workspaceId, repoRow.id, pulls);
      } catch (err) {
        logger?.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await this.repo.listForRepo(repoRow.id);

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land with zeroed size/diff. Backfill them once from the detail endpoint
    // so the list shows real S/M/L + ± counts. Capped per request (each backfill
    // is a detail fetch, run concurrently) — the periodic refetch chips away at
    // any remainder.
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      await Promise.all(
        needStats.map(async (r) => {
          try {
            const detail = await gh.getPullRequest({ owner: repoRow.owner, name: repoRow.name }, r.number);
            await this.repo.updateDiffStats(r.id, {
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
            });
            r.additions = detail.additions;
            r.deletions = detail.deletions;
            r.filesCount = detail.files_count;
          } catch (err) {
            logger?.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
          }
        }),
      );
    }

    // Latest-review SCORE per PR for the list's score ring. Computed on read
    // from reviews (no FK denorm); the list is small, so IN-queries + JS
    // grouping are cheap.
    const prIds = rows.map((r) => r.id);
    const latestReviewByPr = new Map<string, { id: string; score: number | null }>();
    const reviewIdsByPr = new Map<string, string[]>();
    const latestReviewIdByPrAgent = new Map<string, string>();
    const reviewRows = await this.repo.latestReviewsForPrs(prIds);
    // Rows are newest-first → first seen per PR is the latest review overall
    // (score), and first seen per PR+agent is that agent's latest run
    // (findings — see below).
    for (const rv of reviewRows) {
      if (!latestReviewByPr.has(rv.prId)) {
        latestReviewByPr.set(rv.prId, { id: rv.id, score: rv.score });
      }
      const agentKey = `${rv.prId}::${rv.agentId ?? ''}`;
      if (!latestReviewIdByPrAgent.has(agentKey)) {
        latestReviewIdByPrAgent.set(agentKey, rv.id);
        reviewIdsByPr.set(rv.prId, [...(reviewIdsByPr.get(rv.prId) ?? []), rv.id]);
      }
    }

    // FINDINGS summed per AGENT's latest run, across every agent that has
    // run on the PR — not every review ever run. A re-run of the same agent
    // no longer stacks its stale findings on top of its newer ones (only its
    // most recent run counts); different agents each still contribute their
    // own latest run independently, so an earlier agent's severe findings
    // aren't hidden by a later, less-severe agent's run (see
    // server/specs/pr-cost-and-findings.md). No LLM call — `reviewIdsByPr`
    // above already holds only the latest-per-agent review ids.
    const findingsByReview = new Map<string, Finding[]>();
    const allReviewIds = [...reviewIdsByPr.values()].flat();
    const findingRows = await this.repo.findingsForReviews(allReviewIds);
    for (const f of findingRows) {
      const list = findingsByReview.get(f.reviewId) ?? [];
      list.push(findingRowToDto(f));
      findingsByReview.set(f.reviewId, list);
    }

    // Total COST across every SUCCESSFUL run of each PR. Computed on read, same
    // one-IN-query + JS-grouping shape as the score above. Runs whose provider
    // didn't report a cost are priced from model + tokens via the PriceBook (no
    // extra model calls). A PR with no successful runs sums to null — the list
    // shows a dash, not a misleading "$0.00" for a PR nothing has priced yet.
    const runsByPr = new Map<string, { costUsd: number | null; model: string | null; tokensIn: number | null; tokensOut: number | null }[]>();
    const runRows = await this.repo.successfulRunCostsForPrs(workspaceId, prIds);
    for (const r of runRows) {
      if (!r.prId) continue; // prId is nullable (ON DELETE SET NULL)
      const list = runsByPr.get(r.prId) ?? [];
      list.push(r);
      runsByPr.set(r.prId, list);
    }
    const estimateCost: Estimator = (m, i, o) => this.container.priceBook.estimate(m, i, o);

    const now = Date.now();
    return rows.map((r) => {
      const review = latestReviewByPr.get(r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        author: r.author,
        branch: r.branch,
        base: r.base,
        head_sha: r.headSha,
        additions: r.additions,
        deletions: r.deletions,
        files_count: r.filesCount,
        status: deriveReviewStatus({
          ghStatus: r.status,
          lastReviewedSha: r.lastReviewedSha,
          headSha: r.headSha,
          updatedAt: r.updatedAt,
          now,
        }),
        opened_at: r.openedAt?.toISOString() ?? null,
        updated_at: r.updatedAt?.toISOString() ?? null,
        score: review ? review.score : null,
        cost_usd: sumRunCosts(runsByPr.get(r.id) ?? [], estimateCost),
        findings: (reviewIdsByPr.get(r.id) ?? []).flatMap((id) => findingsByReview.get(id) ?? []),
      };
    });
  }

  // ===========================================================================
  // Manual poll — MANUAL refresh that ONLY syncs the PR list (new/updated PRs
  // appear, head_sha updates). Does NOT trigger a review — review is manual.
  // ===========================================================================

  async poll(workspaceId: string, repoId: string): Promise<{ synced: number }> {
    const repoRow = await this.requireRepo(workspaceId, repoId);
    const gh = await this.container.github();
    const pulls = await gh.listPullRequests({ owner: repoRow.owner, name: repoRow.name });
    await this.repo.upsertPullRequests(workspaceId, repoRow.id, pulls);
    await this.container.reposRepo.touchPolled(repoRow.id);
    return { synced: pulls.length };
  }

  // ===========================================================================
  // Detail
  // ===========================================================================

  async getDetail(workspaceId: string, id: string, logger?: Logger): Promise<PrDetail> {
    const { pull, repo: repoRow } = await this.requirePull(workspaceId, id);

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body (seeded or previously
    // imported) so PR detail works offline.
    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repoRow.owner, name: repoRow.name }, pull.number);
      await this.repo.replaceDetail(pull.id, {
        body: detail.body ?? null,
        additions: detail.additions,
        deletions: detail.deletions,
        filesCount: detail.files_count,
        files: detail.files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: detail.commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committedAt: c.committed_at ? new Date(c.committed_at) : null,
        })),
      });
      return { ...detail, id: pull.id };
    } catch (err) {
      logger?.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const [files, commits] = await Promise.all([
        this.repo.getPrFiles(pull.id),
        this.repo.getPrCommits(pull.id),
      ]);
      return {
        id: pull.id,
        number: pull.number,
        title: pull.title,
        author: pull.author,
        branch: pull.branch,
        base: pull.base,
        head_sha: pull.headSha,
        additions: pull.additions,
        deletions: pull.deletions,
        files_count: pull.filesCount,
        status: pull.status as PrDetail['status'],
        opened_at: pull.openedAt?.toISOString() ?? null,
        updated_at: pull.updatedAt?.toISOString() ?? null,
        body: pull.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  }

  // ===========================================================================
  // Inline review comments (Files changed tab) — proxied live to GitHub, no
  // local persistence.
  // ===========================================================================

  async listComments(workspaceId: string, id: string, logger?: Logger): Promise<PrReviewComment[]> {
    const { pull, repo: repoRow } = await this.requirePull(workspaceId, id);
    const gh = await this.githubOrNull(logger, 'serving no PR comments');
    if (!gh) return [];
    try {
      return await gh.listReviewComments({ owner: repoRow.owner, name: repoRow.name }, pull.number);
    } catch (err) {
      logger?.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async postComment(
    workspaceId: string,
    id: string,
    input: PrCommentInput,
  ): Promise<PrReviewComment> {
    const { pull, repo: repoRow } = await this.requirePull(workspaceId, id);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
    }
    try {
      return await gh.createReviewComment({ owner: repoRow.owner, name: repoRow.name }, pull.number, {
        commitId: pull.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub rejects comments on lines outside the diff / on closed PRs (422).
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }
}
