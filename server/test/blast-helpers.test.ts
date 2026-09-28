/**
 * Blast Radius (L04) — the pure mapping from repo-intel's `BlastResult` to the
 * wire response. Hermetic: no Postgres, no network, no composition root, no
 * mocks — `BlastResult` literals in, a `BlastRadiusResponse` out.
 *
 * What this function DECIDES, and therefore what is asserted here:
 *   - one `downstream` entry per unique changed-symbol NAME, including names
 *     with zero callers (the card renders one row per changed symbol, so the
 *     response is the render list and needs no client-side join),
 *   - a caller declared in the symbol's OWN file is not a caller of it (the
 *     facade drops those with an explicit filter on one path and only as a
 *     consequence of import-graph resolution on the other, so this is
 *     defensive) — while a caller that merely happens to be another CHANGED
 *     file is legitimate and kept,
 *   - endpoints/crons are attributed to a symbol ONLY through `factsByFile`;
 *     the flat `impactedEndpoints` union is never pinned on a particular
 *     symbol, because that is a claim the data does not support,
 *   - the render ORDER: maxRank desc, caller count desc, name asc — the two
 *     tiebreakers exist because the ripgrep fallback sets every rank to 0,
 *   - `summary` is deterministic string interpolation. No model call.
 */
import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import type {
  BlastCallerRow,
  BlastChangedSymbol,
  BlastResult,
} from '../src/modules/repo-intel/types.js';
import { BlastRadiusResponse } from '@devdigest/shared';
import { toBlastRadiusResponse } from '../src/modules/blast/helpers.js';

function sym(name: string, file: string, kind = 'function'): BlastChangedSymbol {
  return { name, file, kind };
}

function caller(
  file: string,
  symbol: string,
  viaSymbol: string,
  line: number,
  rank = 0,
): BlastCallerRow {
  return { file, symbol, viaSymbol, line, rank };
}

function result(over: Partial<BlastResult> = {}): BlastResult {
  return { changedSymbols: [], callers: [], impactedEndpoints: [], ...over };
}

/** Both the route-local schema AND the shared contract must accept the output. */
function bothSchemasAccept(out: unknown): void {
  expect(() => BlastRadiusResponse.parse(out)).not.toThrow();
  expect(() => BlastRadius.parse(out)).not.toThrow();
}

const FILE = 'src/api/rate-limit.ts';

describe('toBlastRadiusResponse — changed symbols and grouping', () => {
  it('maps every changed symbol by allowlist and groups callers by the symbol they reach', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE), sym('resetBuckets', FILE, 'arrow')],
        callers: [
          caller('src/api/public/index.ts', 'listItems', 'rateLimit', 23, 90),
          caller('src/api/admin/index.ts', 'flush', 'rateLimit', 11, 40),
          caller('src/jobs/hourly.ts', 'run', 'resetBuckets', 8, 10),
        ],
      }),
    );

    expect(out.changed_symbols).toEqual([
      { name: 'rateLimit', file: FILE, kind: 'function' },
      { name: 'resetBuckets', file: FILE, kind: 'arrow' },
    ]);
    expect(out.downstream.map((d) => d.symbol)).toEqual(['rateLimit', 'resetBuckets']);
    expect(out.downstream[0]!.callers).toEqual([
      { name: 'listItems', file: 'src/api/public/index.ts', line: 23 },
      { name: 'flush', file: 'src/api/admin/index.ts', line: 11 },
    ]);
    expect(out.downstream[1]!.callers).toEqual([
      { name: 'run', file: 'src/jobs/hourly.ts', line: 8 },
    ]);
    bothSchemasAccept(out);
  });

  it('keeps a changed symbol with ZERO callers as its own entry', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE), sym('unused', FILE)],
        callers: [caller('src/api/public/index.ts', 'listItems', 'rateLimit', 23, 5)],
      }),
    );

    expect(out.downstream.map((d) => d.symbol)).toEqual(['rateLimit', 'unused']);
    const unused = out.downstream.find((d) => d.symbol === 'unused')!;
    expect(unused.callers).toEqual([]);
    expect(unused.endpoints_affected).toEqual([]);
    expect(unused.crons_affected).toEqual([]);
    bothSchemasAccept(out);
  });

  it('drops a caller declared in the symbol\'s OWN file, but keeps another changed file', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE), sym('buildKey', 'src/api/keys.ts')],
        callers: [
          // Self-file: `rateLimit` calling itself from its own declaration file
          // is not downstream impact.
          caller(FILE, 'rateLimitInner', 'rateLimit', 5, 50),
          // Another file that this same PR also changed — a legitimate caller.
          caller('src/api/keys.ts', 'buildKey', 'rateLimit', 14, 50),
        ],
      }),
    );

    const rateLimit = out.downstream.find((d) => d.symbol === 'rateLimit')!;
    expect(rateLimit.callers).toEqual([
      { name: 'buildKey', file: 'src/api/keys.ts', line: 14 },
    ]);
  });

  it('dedupes identical caller rows (same file, symbol and line)', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE)],
        callers: [
          caller('src/api/public/index.ts', 'listItems', 'rateLimit', 23, 90),
          caller('src/api/public/index.ts', 'listItems', 'rateLimit', 23, 90),
          // Same file and symbol, DIFFERENT line — a second real call site.
          caller('src/api/public/index.ts', 'listItems', 'rateLimit', 31, 90),
        ],
      }),
    );

    expect(out.downstream[0]!.callers).toEqual([
      { name: 'listItems', file: 'src/api/public/index.ts', line: 23 },
      { name: 'listItems', file: 'src/api/public/index.ts', line: 31 },
    ]);
  });
});

describe('toBlastRadiusResponse — endpoints and crons come only from factsByFile', () => {
  it('unions endpoints across a symbol\'s caller files, deduped and sorted ascending', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE)],
        callers: [
          caller('src/api/public/index.ts', 'listItems', 'rateLimit', 23, 90),
          caller('src/api/public/b.ts', 'other', 'rateLimit', 4, 80),
        ],
        factsByFile: {
          'src/api/public/index.ts': {
            endpoints: ['GET /api/public/items', 'POST /api/public/items'],
            crons: [],
          },
          // The SAME endpoint reached through a second caller file.
          'src/api/public/b.ts': { endpoints: ['GET /api/public/items'], crons: [] },
        },
      }),
    );

    expect(out.downstream[0]!.endpoints_affected).toEqual([
      'GET /api/public/items',
      'POST /api/public/items',
    ]);
    expect(out.downstream[0]!.crons_affected).toEqual([]);
  });

  it('populates crons without cross-contaminating endpoints, sorted ascending', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('resetBuckets', FILE)],
        callers: [
          caller('src/jobs/hourly.ts', 'run', 'resetBuckets', 8, 10),
          caller('src/jobs/nightly.ts', 'run', 'resetBuckets', 9, 10),
        ],
        factsByFile: {
          'src/jobs/hourly.ts': {
            endpoints: [],
            crons: ['reset-rate-buckets (hourly)'],
          },
          'src/jobs/nightly.ts': {
            endpoints: [],
            crons: ['archive-buckets (nightly)', 'reset-rate-buckets (hourly)'],
          },
        },
      }),
    );

    expect(out.downstream[0]!.crons_affected).toEqual([
      'archive-buckets (nightly)',
      'reset-rate-buckets (hourly)',
    ]);
    expect(out.downstream[0]!.endpoints_affected).toEqual([]);
  });

  it('attributes NOTHING when factsByFile is absent, even with a flat impactedEndpoints', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE)],
        callers: [caller('src/api/public/index.ts', 'listItems', 'rateLimit', 23)],
        // The ripgrep fallback path: a repo-wide union with NO per-file
        // attribution. Pinning it on a symbol would fabricate a dependency.
        impactedEndpoints: ['GET /api/public/items', 'GET /api/other'],
        degraded: true,
        reason: 'no_data',
      }),
    );

    for (const entry of out.downstream) {
      expect(entry.endpoints_affected).toEqual([]);
      expect(entry.crons_affected).toEqual([]);
    }
  });
});

describe('toBlastRadiusResponse — render order', () => {
  it('orders by maxRank descending, sinking a zero-caller symbol to the bottom', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('low', FILE), sym('high', FILE), sym('none', FILE)],
        callers: [
          caller('src/a.ts', 'a', 'low', 1, 10),
          caller('src/b.ts', 'b', 'high', 2, 90),
        ],
      }),
    );

    expect(out.downstream.map((d) => d.symbol)).toEqual(['high', 'low', 'none']);
  });

  it('breaks an equal-rank tie on caller count, then on name — the fallback path has no ranks', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('one', FILE), sym('two', FILE), sym('alpha', FILE)],
        callers: [
          caller('src/a.ts', 'a', 'two', 1),
          caller('src/b.ts', 'b', 'two', 2),
          caller('src/c.ts', 'c', 'one', 3),
          caller('src/d.ts', 'd', 'alpha', 4),
        ],
      }),
    );

    expect(out.downstream.map((d) => d.symbol)).toEqual(['two', 'alpha', 'one']);
  });
});

describe('toBlastRadiusResponse — degraded passthrough and summary', () => {
  it('carries degraded and reason through, with the degraded suffix on the summary', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE)],
        callers: [caller('src/api/public/index.ts', 'listItems', 'rateLimit', 23)],
        degraded: true,
        reason: 'no_data',
      }),
    );

    expect(out.degraded).toBe(true);
    expect(out.reason).toBe('no_data');
    expect(out.summary).toBe(
      '1 changed symbol(s), 1 caller(s) in 1 file(s), 0 endpoint(s), 0 cron(s).' +
        ' Index incomplete (no_data) — results may be missing callers.',
    );
    bothSchemasAccept(out);
  });

  it('omits both keys entirely when the facade did not degrade', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE)],
        callers: [],
        degraded: false,
      }),
    );

    expect('degraded' in out).toBe(false);
    expect('reason' in out).toBe(false);
    bothSchemasAccept(out);
  });

  it('reports no call graph at all for the facade\'s empty degraded result', () => {
    // This is verbatim the `empty` literal repo-intel returns when it has
    // nothing usable — the only empty result that actually reaches us.
    const out = toBlastRadiusResponse(
      result({ degraded: true, reason: 'index_failed' }),
    );

    expect(out.changed_symbols).toEqual([]);
    expect(out.downstream).toEqual([]);
    expect(out.summary).toBe(
      '0 changed symbol(s), 0 caller(s) in 0 file(s), 0 endpoint(s), 0 cron(s).' +
        ' Index incomplete (index_failed) — no call graph available.',
    );
    bothSchemasAccept(out);
  });

  it('builds the summary verbatim from the counts, deduping endpoints and crons globally', () => {
    const out = toBlastRadiusResponse(
      result({
        changedSymbols: [sym('rateLimit', FILE), sym('resetBuckets', FILE)],
        callers: [
          caller('src/api/public/index.ts', 'listItems', 'rateLimit', 23, 90),
          caller('src/api/admin/index.ts', 'flush', 'rateLimit', 11, 40),
          caller('src/jobs/hourly.ts', 'run', 'resetBuckets', 8, 10),
        ],
        factsByFile: {
          'src/api/public/index.ts': { endpoints: ['GET /api/public/items'], crons: [] },
          'src/api/admin/index.ts': { endpoints: ['POST /api/admin/flush'], crons: [] },
          'src/jobs/hourly.ts': { endpoints: [], crons: ['reset-rate-buckets (hourly)'] },
        },
      }),
    );

    expect(out.summary).toBe(
      '2 changed symbol(s), 3 caller(s) in 3 file(s), 2 endpoint(s), 1 cron(s).',
    );
    bothSchemasAccept(out);
  });
});
