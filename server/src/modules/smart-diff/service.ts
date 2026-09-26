/**
 * Smart Diff (L04) — the read-only use case behind `GET /pulls/:id/smart-diff`.
 *
 * Reads the PR's changed files and the LATEST review's findings, classifies
 * each file with the pure helper, and returns the `SmartDiff` contract. There
 * is NO model call, no persistence, no new table — grouping is a deterministic
 * function of `pr_files.path`, so it works on a PR that has never been
 * reviewed (an empty review list simply yields empty `finding_lines`).
 *
 * The one dependency is typed `Container['reviewRepo']` rather than the
 * concrete `ReviewRepository` class ON PURPOSE: naming the class would force
 * an import of `../reviews/repository.js`, and that edge is the
 * `no-cross-module-repository` rule in `.dependency-cruiser.cjs`. `import
 * type` does not escape it either — `tsPreCompilationDeps: true` keeps
 * type-only imports in the graph. Precedent: `reviews/service.ts`'s
 * `private agents: Container['agentsRepo']`.
 */
import type { SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { groupFilesByRole, totalChangedLines } from './helpers.js';

export class SmartDiffService {
  constructor(private repo: Container['reviewRepo']) {}

  /** The role-grouped view of one PR's diff. Workspace-scoped via the PR. */
  async forPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    // The PR lookup IS the workspace scope check — there is no second one.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);

    // `reviewsForPull` orders `desc(created_at)`, so the latest review is the
    // first row. No review at all is a normal state, not an error.
    const reviews = await this.repo.reviewsForPull(prId);
    const latest = reviews[0];

    // file path → its findings' start lines, deduped and ascending.
    const linesByPath = new Map<string, number[]>();
    for (const finding of latest?.findings ?? []) {
      const seen = linesByPath.get(finding.file) ?? [];
      if (!seen.includes(finding.startLine)) seen.push(finding.startLine);
      linesByPath.set(finding.file, seen);
    }
    for (const lines of linesByPath.values()) lines.sort((a, b) => a - b);

    return {
      groups: groupFilesByRole(
        files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          // A finding citing a file this PR does not touch creates no phantom
          // file: only `pr_files` rows are iterated here.
          findingLines: linesByPath.get(f.path) ?? [],
        })),
      ),
      split_suggestion: {
        too_big: false,
        total_lines: totalChangedLines(files),
        proposed_splits: [],
      },
    };
  }
}
