import { describe, it, expect } from 'vitest';
import type { FindingRecord, MultiAgentColumn } from '@devdigest/shared';
import {
  averageEstimate,
  buildDisagreements,
  computeTotals,
  deriveParentStatus,
  failedRunCost,
  groupFindings,
  noteFromRationale,
} from '../src/modules/multi-agent/helpers.js';

/**
 * Hermetic coverage for the multi-agent pure policy: location grouping,
 * disagreement takes + conflict flag, parent status, estimates and the
 * failed-cost rule. Fixtures follow the spec's cases.
 */

let seq = 0;
function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  seq += 1;
  return {
    id: `f${seq}`,
    severity: 'WARNING',
    category: 'bug',
    title: `Finding ${seq}`,
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'First sentence here. Second sentence.',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    review_id: 'r1',
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

function column(
  runId: string,
  status: MultiAgentColumn['status'],
  findings: FindingRecord[] = [],
  over: Partial<MultiAgentColumn> = {},
): MultiAgentColumn {
  return {
    run_id: runId,
    agent_id: `agent-${runId}`,
    agent_name: `Agent ${runId}`,
    provider: 'openai',
    model: 'gpt-4.1',
    status,
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings,
    ...over,
  };
}

describe('groupFindings', () => {
  it('groups the same lines across agents regardless of category (AC-56)', () => {
    const cols = [
      column('a', 'done', [finding({ category: 'bug', start_line: 40, end_line: 42 })]),
      column('b', 'done', [finding({ category: 'security', start_line: 40, end_line: 42 })]),
    ];
    const groups = groupFindings(cols);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(2);
    expect(groups[0]!.id).toBe('src/a.ts:40-42');
  });

  it('keeps non-overlapping adjacent lines apart — no tolerance (AC-57)', () => {
    const cols = [
      column('a', 'done', [finding({ start_line: 52, end_line: 52 })]),
      column('b', 'done', [finding({ start_line: 53, end_line: 53 })]),
    ];
    expect(groupFindings(cols)).toHaveLength(2);
  });

  it('merges a transitive chain into one group', () => {
    const cols = [
      column('a', 'done', [finding({ start_line: 10, end_line: 12 })]),
      column('b', 'done', [finding({ start_line: 12, end_line: 15 })]),
      column('c', 'done', [finding({ start_line: 15, end_line: 20 })]),
    ];
    const groups = groupFindings(cols);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ start_line: 10, end_line: 20 });
  });

  it('never merges across files and titles the group by its most severe member', () => {
    const cols = [
      column('a', 'done', [finding({ severity: 'SUGGESTION', title: 'minor' })]),
      column('b', 'done', [
        finding({ severity: 'CRITICAL', title: 'major' }),
        finding({ file: 'src/b.ts' }),
      ]),
    ];
    const groups = groupFindings(cols);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.file === 'src/a.ts')!.title).toBe('major');
  });
});

describe('buildDisagreements', () => {
  it('gives flagged / no_result / pending / did_not_flag per column (AC-33, AC-35, AC-36)', () => {
    const cols = [
      column('a', 'done', [finding({ start_line: 5, end_line: 5 })]),
      column('b', 'failed'),
      column('c', 'running'),
      column('d', 'done'),
    ];
    const rows = buildDisagreements(cols, groupFindings(cols));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.takes.map((t) => t.kind)).toEqual([
      'flagged',
      'no_result',
      'pending',
      'did_not_flag',
    ]);
  });

  it('carries no note on did_not_flag takes (AC-60)', () => {
    const cols = [column('a', 'done', [finding()]), column('b', 'done')];
    const take = buildDisagreements(cols, groupFindings(cols))[0]!.takes[1]!;
    expect(take.kind).toBe('did_not_flag');
    expect(take).not.toHaveProperty('note');
  });

  it('uses the highest severity of one agent and its first sentence as note (AC-58)', () => {
    const cols = [
      column('a', 'done', [
        finding({ severity: 'SUGGESTION', start_line: 7, end_line: 7 }),
        finding({ severity: 'WARNING', start_line: 7, end_line: 8, rationale: 'Real issue. More.' }),
      ]),
      column('b', 'done'),
    ];
    const take = buildDisagreements(cols, groupFindings(cols))[0]!.takes[0]!;
    expect(take.kind).toBe('flagged');
    if (take.kind !== 'flagged') return;
    expect(take.severity).toBe('WARNING');
    expect(take.note).toBe('Real issue.');
    expect(take.finding_ids).toHaveLength(2);
  });

  it('flags conflicts per the truth table (AC-37, AC-38)', () => {
    const same = [
      column('a', 'done', [finding({ severity: 'WARNING' })]),
      column('b', 'done', [finding({ severity: 'WARNING' })]),
    ];
    expect(buildDisagreements(same, groupFindings(same))[0]!.conflict).toBe(false);

    const diffSeverity = [
      column('a', 'done', [finding({ severity: 'WARNING' })]),
      column('b', 'done', [finding({ severity: 'CRITICAL' })]),
    ];
    expect(buildDisagreements(diffSeverity, groupFindings(diffSeverity))[0]!.conflict).toBe(true);

    const flaggedVsNot = [column('a', 'done', [finding()]), column('b', 'done')];
    expect(buildDisagreements(flaggedVsNot, groupFindings(flaggedVsNot))[0]!.conflict).toBe(true);

    // A failed column is not a "did not flag" and so never creates a conflict.
    const withFailed = [column('a', 'done', [finding()]), column('b', 'failed')];
    expect(buildDisagreements(withFailed, groupFindings(withFailed))[0]!.conflict).toBe(false);
  });

  it('is empty with fewer than 2 columns or no done column', () => {
    const one = [column('a', 'done', [finding()])];
    expect(buildDisagreements(one, groupFindings(one))).toEqual([]);
    const noneDone = [column('a', 'failed'), column('b', 'running')];
    expect(buildDisagreements(noneDone, [])).toEqual([]);
  });
});

describe('deriveParentStatus (AC-47, AC-48)', () => {
  it('maps child statuses to the parent status', () => {
    expect(deriveParentStatus(['done', 'done'])).toBe('done');
    expect(deriveParentStatus(['done', 'failed'])).toBe('partial');
    expect(deriveParentStatus(['failed', 'cancelled'])).toBe('failed');
    expect(deriveParentStatus(['done', 'running'])).toBe('running');
  });
});

describe('averageEstimate', () => {
  it('averages 6s and 8s to 7000ms (AC-13)', () => {
    const e = averageEstimate([
      { durationMs: 6000, cost: 0.1 },
      { durationMs: 8000, cost: 0.3 },
    ]);
    expect(e).toEqual({ avg_duration_ms: 7000, avg_cost_usd: 0.2, sample_size: 2 });
  });

  it('gives sample_size 0 and null averages with no rows (AC-15)', () => {
    expect(averageEstimate([])).toEqual({ avg_duration_ms: null, avg_cost_usd: null, sample_size: 0 });
  });
});

describe('failedRunCost (AC-55)', () => {
  const estimate = () => 0.5;
  it('returns a reported cost verbatim', () => {
    expect(
      failedRunCost({ costUsd: 0.02, model: 'm', tokensIn: 0, tokensOut: 0 }, estimate),
    ).toBe(0.02);
  });
  it('is unknown, never $0, with no cost and zero tokens', () => {
    expect(
      failedRunCost({ costUsd: null, model: 'm', tokensIn: 0, tokensOut: 0 }, estimate),
    ).toBeNull();
  });
  it('prices a failed run that consumed tokens', () => {
    expect(
      failedRunCost({ costUsd: null, model: 'm', tokensIn: 10, tokensOut: 5 }, estimate),
    ).toBe(0.5);
  });
});

describe('computeTotals (AC-55)', () => {
  it('sums done children only and keeps failed cost separate', () => {
    const totals = computeTotals(
      [
        { status: 'done', duration_ms: 4000, cost_usd: 0.1 },
        { status: 'done', duration_ms: 8200, cost_usd: 0.1 },
        { status: 'failed', duration_ms: 1000, cost_usd: 0.05 },
      ],
      [0.05],
    );
    expect(totals).toEqual({
      agent_count: 3,
      total_duration_ms: 8200,
      total_cost_usd: 0.2,
      failed_cost_usd: 0.05,
    });
  });

  it('has a null failed cost when none is known', () => {
    const totals = computeTotals([{ status: 'failed', duration_ms: null, cost_usd: null }], [null]);
    expect(totals.failed_cost_usd).toBeNull();
    expect(totals.total_cost_usd).toBeNull();
    expect(totals.total_duration_ms).toBeNull();
  });
});

describe('noteFromRationale', () => {
  it('returns plain text, first sentence, capped', () => {
    expect(noteFromRationale('**Bold** `code` here. Next.')).toBe('Bold code here.');
    expect(noteFromRationale('x'.repeat(500)).length).toBeLessThanOrEqual(160);
  });
});
