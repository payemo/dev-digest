import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EvalExpectedFinding, Finding } from '@devdigest/shared';
import {
  aggregateRun,
  rangesIntersect,
  scoreCase,
  type ScoredCase,
} from '../src/modules/eval/scoring.js';

/**
 * Mechanical eval scoring (spec 04, FR-14 – FR-18). Every expected value below
 * is computed by hand from the spec's formulas, never by calling the scorer:
 *   recall    = Σ matched ÷ Σ must_find expectations
 *   precision = 1 − Σ forbidden-location hits ÷ Σ grounded
 *   citation  = Σ grounded ÷ Σ emitted
 * with a zero denominator → null ("not applicable") and errored cases excluded.
 */

let seq = 0;
function finding(file: string, start: number, end = start): Finding {
  seq += 1;
  return {
    id: `f-${seq}`,
    severity: 'WARNING',
    category: 'security',
    title: `finding ${seq}`,
    file,
    start_line: start,
    end_line: end,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
  };
}

function expectation(file: string, start: number, end?: number): EvalExpectedFinding {
  return {
    severity: 'CRITICAL',
    category: 'security',
    title: 'expected',
    file,
    start_line: start,
    ...(end !== undefined ? { end_line: end } : {}),
  };
}

const mustFind = (expected: EvalExpectedFinding[], grounded: Finding[], emitted = grounded.length) =>
  scoreCase({ kind: 'must_find', expected, forbidden: null, grounded, emitted });

const mustNotFlag = (
  forbidden: { file: string; start_line: number; end_line: number } | null,
  grounded: Finding[],
  emitted = grounded.length,
) => scoreCase({ kind: 'must_not_flag', expected: [], forbidden, grounded, emitted });

describe('eval scoring — matching (FR-14)', () => {
  it('AC-38: equal file + inclusive range intersection; different file never matches', () => {
    // src/a.ts:10-14 vs the single-line expectation src/a.ts:12
    expect(rangesIntersect('src/a.ts', 10, 14, { file: 'src/a.ts', start: 12, end: 12 })).toBe(true);
    expect(rangesIntersect('src/a.ts', 13, 14, { file: 'src/a.ts', start: 12, end: 12 })).toBe(false);
    expect(rangesIntersect('src/b.ts', 10, 14, { file: 'src/a.ts', start: 12, end: 12 })).toBe(false);
    // Inclusive at both edges.
    expect(rangesIntersect('src/a.ts', 10, 12, { file: 'src/a.ts', start: 12, end: 20 })).toBe(true);
    expect(rangesIntersect('src/a.ts', 21, 30, { file: 'src/a.ts', start: 12, end: 20 })).toBe(false);
  });

  it('an expectation with only start_line is [start, start] when scored', () => {
    const exp = [expectation('src/a.ts', 12)];
    expect(mustFind(exp, [finding('src/a.ts', 10, 14)]).status).toBe('passed');
    expect(mustFind(exp, [finding('src/a.ts', 13, 14)]).status).toBe('failed');
    expect(mustFind(exp, [finding('src/other.ts', 12)]).status).toBe('failed');
  });
});

describe('eval scoring — case pass rules (FR-15)', () => {
  it('AC-39: must_find with one expectation passes with a match and fails without', () => {
    const exp = [expectation('src/config.ts', 12)];
    const pass = mustFind(exp, [finding('src/config.ts', 12)]);
    expect(pass).toMatchObject({ status: 'passed', matched: [0], expectedN: 1, gotM: 1 });
    const fail = mustFind(exp, []);
    expect(fail).toMatchObject({ status: 'failed', matched: [], expectedN: 1, gotM: 0 });
  });

  it('must_find needs EVERY expectation matched; an expectation hit twice counts once', () => {
    const exp = [expectation('src/a.ts', 5), expectation('src/a.ts', 40, 42)];
    const partial = mustFind(exp, [finding('src/a.ts', 5), finding('src/a.ts', 4, 6)]);
    expect(partial.status).toBe('failed');
    expect(partial.matched).toEqual([0]);
    expect(partial.recallNum).toBe(1); // two findings on expectation 0 → still 1
    expect(partial.recallDen).toBe(2);
    expect(partial.gotM).toBe(2); // M = grounded findings on a must_find case
  });

  it('AC-40: must_not_flag fails on a hit at the forbidden location, passes with findings elsewhere', () => {
    const loc = { file: 'src/api/users.ts', start_line: 2, end_line: 2 };
    const hit = mustNotFlag(loc, [finding('src/api/users.ts', 1, 3)]);
    expect(hit).toMatchObject({ status: 'failed', expectedN: 0, gotM: 1, noise: 1 });
    const elsewhere = mustNotFlag(loc, [finding('src/api/users.ts', 10), finding('src/x.ts', 2)]);
    expect(elsewhere).toMatchObject({ status: 'passed', expectedN: 0, gotM: 0, noise: 0 });
  });

  it('AC-41 / AC-26: must_not_flag with no location fails on ANY grounded finding (M = all grounded)', () => {
    expect(mustNotFlag(null, [])).toMatchObject({ status: 'passed', gotM: 0 });
    expect(mustNotFlag(null, [finding('src/x.ts', 1), finding('src/y.ts', 9)])).toMatchObject({
      status: 'failed',
      expectedN: 0,
      gotM: 2,
      noise: 2,
    });
  });
});

describe('eval scoring — run metrics (FR-16 – FR-18)', () => {
  it('AC-42: 4 of 5 expectations matched gives recall 0.8', () => {
    const a = mustFind(
      [expectation('a.ts', 1), expectation('a.ts', 10), expectation('a.ts', 20)],
      [finding('a.ts', 1), finding('a.ts', 10), finding('a.ts', 20)],
    );
    const b = mustFind([expectation('b.ts', 1), expectation('b.ts', 50)], [finding('b.ts', 1)]);
    expect(aggregateRun([a, b]).recall).toBe(0.8);
  });

  it('AC-43: one must_not_flag case, 4 grounded, 1 at the forbidden location → precision 0.75', () => {
    const c = mustNotFlag({ file: 'x.ts', start_line: 5, end_line: 5 }, [
      finding('x.ts', 5),
      finding('x.ts', 30),
      finding('y.ts', 5),
      finding('z.ts', 1),
    ]);
    expect(aggregateRun([c]).precision).toBe(0.75);
  });

  it('AC-44: 10 emitted, 9 grounded → citation_accuracy 0.9', () => {
    const grounded = Array.from({ length: 9 }, (_, i) => finding('a.ts', i + 1));
    const c = mustFind([expectation('a.ts', 1)], grounded, 10);
    expect(aggregateRun([c]).citation_accuracy).toBe(0.9);
  });

  it('AC-45: a grounding-dropped finding only moves citation_accuracy', () => {
    const exp = [expectation('a.ts', 1)];
    const grounded = [finding('a.ts', 1)];
    const forbiddenCase = mustNotFlag({ file: 'n.ts', start_line: 1, end_line: 1 }, [
      finding('n.ts', 1),
      finding('n.ts', 9),
    ]);
    const without = aggregateRun([mustFind(exp, grounded, 1), forbiddenCase]);
    // Same grounded output, but one extra finding was emitted and then dropped by the gate.
    const withDropped = aggregateRun([mustFind(exp, grounded, 2), forbiddenCase]);
    expect(withDropped.recall).toBe(without.recall);
    expect(withDropped.precision).toBe(without.precision);
    expect(without.citation_accuracy).toBe(1); // 3 grounded / 3 emitted
    expect(withDropped.citation_accuracy).toBe(0.75); // 3 grounded / 4 emitted
  });

  it('AC-46: an unmatched extra finding on a must_find case is not noise', () => {
    const exp = [expectation('a.ts', 1)];
    const extra = mustFind(exp, [finding('a.ts', 1), finding('a.ts', 99)]);
    expect(extra.noise).toBe(0);
    expect(extra.status).toBe('passed');
    expect(aggregateRun([extra]).precision).toBe(1);
  });

  it('AC-47: a set of only must_not_flag cases has recall not applicable (null)', () => {
    const agg = aggregateRun([
      mustNotFlag({ file: 'a.ts', start_line: 1, end_line: 1 }, [finding('b.ts', 1)]),
      mustNotFlag(null, []),
    ]);
    expect(agg.recall).toBeNull();
    expect(agg.precision).toBe(1);
  });

  it('AC-48: no emitted findings → precision and citation_accuracy are null, never 0 or 1', () => {
    const agg = aggregateRun([mustFind([expectation('a.ts', 1)], [], 0), mustNotFlag(null, [], 0)]);
    expect(agg.precision).toBeNull();
    expect(agg.citation_accuracy).toBeNull();
    expect(agg.recall).toBe(0); // the must_find denominator is 1, so recall IS applicable
  });

  it('an empty or all-errored run has every metric null', () => {
    expect(aggregateRun([])).toEqual({
      recall: null,
      precision: null,
      citation_accuracy: null,
      passed: 0,
      errored: 0,
      total: 0,
    });
    const allErrored = aggregateRun([{ status: 'errored' }, { status: 'errored' }]);
    expect(allErrored).toMatchObject({ recall: null, precision: null, citation_accuracy: null });
    expect(allErrored).toMatchObject({ passed: 0, errored: 2, total: 2 });
  });

  it('AC-50: 7 scored + 1 errored yields exactly the metrics of the 7, with x/8 totals', () => {
    const scored: ScoredCase[] = [
      mustFind([expectation('a.ts', 1)], [finding('a.ts', 1)], 2), // pass, 1/1, 1 dropped
      mustFind([expectation('b.ts', 1)], [finding('b.ts', 1)]), // pass
      mustFind([expectation('c.ts', 1)], []), // fail, 0/1
      mustFind([expectation('d.ts', 1), expectation('d.ts', 9)], [finding('d.ts', 1)]), // fail, 1/2
      mustNotFlag({ file: 'e.ts', start_line: 3, end_line: 3 }, [finding('e.ts', 3)]), // fail, noise 1
      mustNotFlag({ file: 'f.ts', start_line: 3, end_line: 3 }, [finding('f.ts', 40)]), // pass
      mustNotFlag(null, []), // pass
    ];
    const seven = aggregateRun(scored);
    const eight = aggregateRun([...scored.slice(0, 3), { status: 'errored' }, ...scored.slice(3)]);

    // Hand-computed: recall 3/5; grounded 5, noise 1 → precision 0.8; emitted 6 → citation 5/6.
    expect(seven.recall).toBe(3 / 5);
    expect(seven.precision).toBe(1 - 1 / 5);
    expect(seven.citation_accuracy).toBe(5 / 6);
    expect(seven).toMatchObject({ passed: 4, errored: 0, total: 7 });

    expect(eight).toMatchObject({
      recall: seven.recall,
      precision: seven.precision,
      citation_accuracy: seven.citation_accuracy,
      passed: 4,
      errored: 1,
      total: 8,
    });
  });

  it('AC-37: scoring the same stored outputs twice gives deep-equal results', () => {
    const input = {
      kind: 'must_find' as const,
      expected: [expectation('a.ts', 1, 3), expectation('a.ts', 10)],
      forbidden: null,
      grounded: [finding('a.ts', 2), finding('a.ts', 50)],
      emitted: 3,
    };
    const first = scoreCase(structuredClone(input));
    const second = scoreCase(structuredClone(input));
    expect(second).toEqual(first);
    expect(aggregateRun([second])).toEqual(aggregateRun([first]));
  });
});

describe('eval scoring — no model call (AC-36 / AC-79)', () => {
  it('scoring.ts has no runtime imports: only erased type imports from @devdigest/shared', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../src/modules/eval/scoring.ts'),
      'utf8',
    );
    // Every import statement, including multi-line ones (match up to the `from` clause).
    const imports = src.match(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const stmt of imports) {
      expect(stmt, `non-type import in scoring.ts: ${stmt}`).toMatch(/^import type\s/);
      expect(stmt).toMatch(/from\s+['"]@devdigest\/shared['"]/);
    }
    // No dynamic import / require either — the module cannot reach a provider.
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it('scoring is synchronous — there is no await point where a provider could be called', () => {
    const r = scoreCase({ kind: 'must_not_flag', expected: [], forbidden: null, grounded: [], emitted: 0 });
    expect(typeof (r as unknown as { then?: unknown }).then).toBe('undefined');
    const agg = aggregateRun([r]);
    expect(typeof (agg as unknown as { then?: unknown }).then).toBe('undefined');
  });
});
