/**
 * BlastService (L04) — hermetic. No Postgres, no network, no composition root:
 * the service has exactly two dependencies, so the seam is two hand-rolled
 * objects carrying only the methods it actually calls.
 *
 * What is under test is the WIRING the pure mapper cannot prove:
 *   - the facade is called ONCE, with the PR's own repoId and its real
 *     `pr_files` paths (the mapper never sees either),
 *   - a degraded facade result reaches the response rather than being swallowed,
 *   - an unknown PR id rejects with NotFoundError — that lookup is the whole
 *     workspace scope check,
 *   - a PR with ZERO changed files resolves rather than throwing, because the
 *     facade already answers an empty list with a degraded empty result.
 *
 * The fakes are cast at the seam because `ReviewRepository` has a private field
 * and so can never be satisfied structurally — the idiom
 * `smart-diff-service.test.ts` uses.
 */
import { describe, it, expect } from 'vitest';
import type { PullRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';
import { BlastService } from '../src/modules/blast/service.js';

const WS = 'ws-1';
const PR_ID = 'pr-1';
const REPO_ID = 'repo-1';

function buildService(opts: { paths: string[]; blast?: BlastResult }) {
  const seen: { repoId: string; files: string[] }[] = [];

  const repo = {
    async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
      return workspaceId === WS && prId === PR_ID
        ? ({ id: PR_ID, repoId: REPO_ID } as PullRow)
        : undefined;
    },
    async getPrFiles(prId: string) {
      return prId === PR_ID
        ? opts.paths.map((path, i) => ({
            id: `file-${i}`,
            prId,
            path,
            additions: 1,
            deletions: 0,
            patch: null,
          }))
        : [];
    },
  };

  const intel = {
    async getBlastRadius(repoId: string, files: string[]): Promise<BlastResult> {
      seen.push({ repoId, files });
      return (
        opts.blast ?? {
          changedSymbols: [{ name: 'rateLimit', file: 'src/api/rate-limit.ts', kind: 'function' }],
          callers: [
            {
              file: 'src/api/public/index.ts',
              symbol: 'listItems',
              viaSymbol: 'rateLimit',
              line: 23,
              rank: 90,
            },
          ],
          impactedEndpoints: [],
        }
      );
    },
  };

  return {
    service: new BlastService(
      repo as unknown as Container['reviewRepo'],
      intel as unknown as Container['repoIntel'],
    ),
    seen,
  };
}

describe('BlastService.forPull', () => {
  it("calls the facade once, with the PR's repoId and its real changed paths", async () => {
    const paths = ['src/api/rate-limit.ts', 'src/api/public/index.ts'];
    const { service, seen } = buildService({ paths });

    const out = await service.forPull(WS, PR_ID);

    expect(seen).toEqual([{ repoId: REPO_ID, files: paths }]);
    expect(out.changed_symbols.map((s) => s.name)).toEqual(['rateLimit']);
    expect(out.downstream[0]!.callers).toEqual([
      { name: 'listItems', file: 'src/api/public/index.ts', line: 23 },
    ]);
  });

  it('passes a degraded facade result through instead of swallowing it', async () => {
    const { service } = buildService({
      paths: ['src/api/rate-limit.ts'],
      blast: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'no_data',
      },
    });

    const out = await service.forPull(WS, PR_ID);

    expect(out.degraded).toBe(true);
    expect(out.reason).toBe('no_data');
    expect(out.downstream).toEqual([]);
  });

  it('rejects an unknown PR id — that lookup is the workspace scope check', async () => {
    const { service, seen } = buildService({ paths: ['a.ts'] });

    await expect(service.forPull(WS, 'pr-missing')).rejects.toThrow(NotFoundError);
    await expect(service.forPull('ws-other', PR_ID)).rejects.toThrow(NotFoundError);
    // Tenancy is decided BEFORE the facade is touched — its tables carry no
    // workspace_id, so a leak here could not be caught further down.
    expect(seen).toEqual([]);
  });

  it('resolves for a PR with zero changed files rather than throwing', async () => {
    const { service, seen } = buildService({
      paths: [],
      blast: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'no_data',
      },
    });

    const out = await service.forPull(WS, PR_ID);

    expect(seen).toEqual([{ repoId: REPO_ID, files: [] }]);
    expect(out.changed_symbols).toEqual([]);
    expect(out.summary).toContain('no call graph available');
  });
});
