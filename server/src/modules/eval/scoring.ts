import type {
  EvalExpectationKind,
  EvalExpectedFinding,
  EvalLocation,
  Finding,
} from '@devdigest/shared';

/**
 * Mechanical eval scoring (FR-14 – FR-18).
 *
 * Every function here is a deterministic transform of its arguments: it reads
 * the findings that already passed the grounding gate and counts matches. It
 * never re-grounds and never asks a model anything — the module has no runtime
 * imports at all, only erased type imports from the shared contracts.
 */

/** Inclusive line range on one file. */
interface Range {
  file: string;
  start: number;
  end: number;
}

function expectationRange(e: EvalExpectedFinding): Range {
  return { file: e.file, start: e.start_line, end: e.end_line ?? e.start_line };
}

function locationRange(l: EvalLocation): Range {
  return { file: l.file, start: l.start_line, end: l.end_line };
}

/**
 * FR-14 — equal file paths AND intersecting inclusive line ranges. A range
 * given backwards (end < start) is normalised first.
 */
export function rangesIntersect(
  file: string,
  start: number,
  end: number,
  other: { file: string; start: number; end: number },
): boolean {
  if (file !== other.file) return false;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const oLo = Math.min(other.start, other.end);
  const oHi = Math.max(other.start, other.end);
  return lo <= oHi && oLo <= hi;
}

function findingHits(f: Finding, r: Range): boolean {
  return rangesIntersect(f.file, f.start_line, f.end_line, r);
}

export interface ScoreCaseInput {
  kind: EvalExpectationKind;
  /** `must_find` expectations (empty for `must_not_flag`). */
  expected: EvalExpectedFinding[];
  /** `must_not_flag` forbidden location; null = "no findings at all". */
  forbidden: EvalLocation | null;
  /** Findings that survived the grounding gate. */
  grounded: Finding[];
  /** Findings emitted BEFORE the gate (kept + dropped). */
  emitted: number;
}

export interface ScoredCase {
  status: 'passed' | 'failed';
  /** Indexes into `expected` that at least one grounded finding matched. */
  matched: number[];
  /** N — expectations (0 for `must_not_flag`). */
  expectedN: number;
  /** M — grounded findings (`must_find`) or grounded findings at the forbidden location (`must_not_flag`). */
  gotM: number;
  recallNum: number;
  recallDen: number;
  /** Grounded findings at a forbidden location — always 0 on `must_find` (FR-16). */
  noise: number;
  groundedCount: number;
  emittedCount: number;
}

/** FR-15 / FR-16 — score one case's grounded output. */
export function scoreCase(input: ScoreCaseInput): ScoredCase {
  const groundedCount = input.grounded.length;
  const emittedCount = input.emitted;

  if (input.kind === 'must_find') {
    const matched: number[] = [];
    input.expected.forEach((e, i) => {
      const r = expectationRange(e);
      // Several findings on one expectation still count once.
      if (input.grounded.some((f) => findingHits(f, r))) matched.push(i);
    });
    const expectedN = input.expected.length;
    return {
      status: expectedN > 0 && matched.length === expectedN ? 'passed' : 'failed',
      matched,
      expectedN,
      gotM: groundedCount,
      recallNum: matched.length,
      recallDen: expectedN,
      noise: 0,
      groundedCount,
      emittedCount,
    };
  }

  const forbidden = input.forbidden ? locationRange(input.forbidden) : null;
  const hits = forbidden
    ? input.grounded.filter((f) => findingHits(f, forbidden)).length
    : groundedCount;
  return {
    status: hits === 0 ? 'passed' : 'failed',
    matched: [],
    expectedN: 0,
    gotM: hits,
    recallNum: 0,
    recallDen: 0,
    noise: hits,
    groundedCount,
    emittedCount,
  };
}

export interface ErroredCase {
  status: 'errored';
}

export interface RunAggregate {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  passed: number;
  errored: number;
  total: number;
}

/**
 * FR-16 – FR-18 — run metrics over the non-errored cases. A zero denominator
 * gives `null` ("not applicable"), never 0 or 1.
 */
export function aggregateRun(results: Array<ScoredCase | ErroredCase>): RunAggregate {
  let recallNum = 0;
  let recallDen = 0;
  let noise = 0;
  let grounded = 0;
  let emitted = 0;
  let passed = 0;
  let errored = 0;
  for (const r of results) {
    if (r.status === 'errored') {
      errored += 1;
      continue;
    }
    if (r.status === 'passed') passed += 1;
    recallNum += r.recallNum;
    recallDen += r.recallDen;
    noise += r.noise;
    grounded += r.groundedCount;
    emitted += r.emittedCount;
  }
  return {
    recall: recallDen > 0 ? recallNum / recallDen : null,
    precision: grounded > 0 ? 1 - noise / grounded : null,
    citation_accuracy: emitted > 0 ? grounded / emitted : null,
    passed,
    errored,
    total: results.length,
  };
}
