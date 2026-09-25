/**
 * SmartDiffService (L04) — hermetic. No Postgres, no network, no container:
 * the service's single dependency is the review repository, so the seam is a
 * hand-rolled object with the three methods it actually calls.
 *
 * What is under test is the WIRING the pure classifier cannot prove:
 *   - a PR with files and ZERO reviews still returns all five groups (this is
 *     the "grouping works before the first review" guarantee),
 *   - only `reviews[0]` (the newest) contributes findings,
 *   - a finding citing a file outside `pr_files` creates no phantom file,
 *   - `total_lines` is the additions+deletions sum,
 *   - an unknown PR id rejects with NotFoundError (the workspace scope check).
 *
 * The fake is cast at the seam because `ReviewRepository` has a private field
 * and so can never be satisfied structurally — the same idiom
 * `intent-service.test.ts` uses for `Container`.
 */
import { describe, it, expect } from 'vitest';
import type { FindingRow, PullRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import { NotFoundError } from '../src/platform/errors.js';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';

const WS = 'ws-1';
const PR_ID = 'pr-1';

interface FakeFile {
  path: string;
  additions: number;
  deletions: number;
}

function finding(file: string, startLine: number, reviewId = 'r1'): FindingRow {
  return {
    id: `f-${file}-${startLine}-${reviewId}`,
    reviewId,
    file,
    startLine,
    endLine: startLine,
    severity: 'WARNING',
    category: 'bug',
    title: 'Something',
    rationale: 'Because',
    suggestion: null,
    confidence: 0.8,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
  } as FindingRow;
}

/** Newest-first, exactly as `reviewsForPull` returns them. */
function buildService(opts: {
  files: FakeFile[];
  reviews?: { id: string; findings: FindingRow[] }[];
}) {
  const repo = {
    async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
      return workspaceId === WS && prId === PR_ID ? ({ id: PR_ID } as PullRow) : undefined;
    },
    async getPrFiles(prId: string) {
      return prId === PR_ID
        ? opts.files.map((f, i) => ({ id: `file-${i}`, prId, patch: null, ...f }))
        : [];
    },
    async reviewsForPull() {
      return (opts.reviews ?? []).map((r) => ({ review: { id: r.id }, findings: r.findings }));
    },
  };
  return new SmartDiffService(repo as unknown as Container['reviewRepo']);
}

describe('SmartDiffService.forPull', () => {
  it('returns all five groups in display order with no review at all', async () => {
    const service = buildService({
      files: [
        { path: 'server/src/modules/reviews/service.ts', additions: 20, deletions: 4 },
        { path: 'server/test/reviews.it.test.ts', additions: 30, deletions: 0 },
        { path: 'pnpm-lock.yaml', additions: 120, deletions: 8 },
      ],
    });

    const diff = await service.forPull(WS, PR_ID);

    expect(diff.groups.map((g) => g.role)).toEqual([
      'core',
      'tests',
      'wiring',
      'docs',
      'boilerplate',
    ]);
    expect(diff.groups.map((g) => g.files.map((f) => f.path))).toEqual([
      ['server/src/modules/reviews/service.ts'],
      ['server/test/reviews.it.test.ts'],
      [],
      [],
      ['pnpm-lock.yaml'],
    ]);
    // Unreviewed is a normal state: every file just has no finding lines.
    expect(diff.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(
      true,
    );
    // The "what this does" line needs a model call and is out of scope.
    expect(diff.groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });

  it('uses only the latest review’s findings, deduped and ascending', async () => {
    const service = buildService({
      files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
      reviews: [
        {
          id: 'newest',
          findings: [
            finding('src/app.ts', 42, 'newest'),
            finding('src/app.ts', 7, 'newest'),
            // Same line cited twice by the same review → one entry.
            { ...finding('src/app.ts', 42, 'newest'), id: 'dupe' },
          ],
        },
        { id: 'older', findings: [finding('src/app.ts', 999, 'older')] },
      ],
    });

    const diff = await service.forPull(WS, PR_ID);

    expect(diff.groups[0]!.files[0]!.finding_lines).toEqual([7, 42]);
  });

  it('does not invent a file for a finding that cites a path outside pr_files', async () => {
    const service = buildService({
      files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }],
      reviews: [
        {
          id: 'r1',
          findings: [finding('src/app.ts', 5), finding('src/never-touched.ts', 11)],
        },
      ],
    });

    const diff = await service.forPull(WS, PR_ID);

    const paths = diff.groups.flatMap((g) => g.files.map((f) => f.path));
    expect(paths).toEqual(['src/app.ts']);
    expect(diff.groups[0]!.files[0]!.finding_lines).toEqual([5]);
  });

  it('sums additions + deletions into split_suggestion.total_lines', async () => {
    const service = buildService({
      files: [
        { path: 'src/app.ts', additions: 10, deletions: 2 },
        { path: 'README.md', additions: 5, deletions: 1 },
      ],
    });

    const diff = await service.forPull(WS, PR_ID);

    expect(diff.split_suggestion).toEqual({
      too_big: false,
      total_lines: 18,
      proposed_splits: [],
    });
  });

  it('404s a PR the workspace cannot see', async () => {
    const service = buildService({ files: [] });
    await expect(service.forPull('other-workspace', PR_ID)).rejects.toThrow(NotFoundError);
  });
});
