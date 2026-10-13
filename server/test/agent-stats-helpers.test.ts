import { describe, it, expect } from 'vitest';
import {
  attachComparison,
  buildAgentStats,
  buildPerformance,
  buildSnapshot,
  pickMostActive,
  previousWindow,
  priceRuns,
  zeroFillDailyUtc,
  type Window,
} from '../src/modules/agent-stats/helpers.js';
import type {
  DecisionRow,
  DoneRunRow,
  RunStatusRow,
  StatsAgentRow,
} from '../src/modules/agent-stats/repository.js';
import type { Estimator } from '../src/platform/run-cost.js';

/**
 * Pure aggregation rules behind GET /agents/:id/stats and GET /agent-performance
 * (plan "Aggregation rules"). Data in, data out — no DB, no model. The
 * DB-backed parity between the two endpoints lives in agent-stats.it.test.ts.
 */

const W: Window = { from: new Date('2026-03-01T00:00:00.000Z'), to: new Date('2026-03-04T00:00:00.000Z') };
const PREV: Window = { from: new Date('2026-02-26T00:00:00.000Z'), to: new Date('2026-03-01T00:00:00.000Z') };

const ALPHA: StatsAgentRow = { id: 'a-alpha', name: 'Alpha', enabled: true };
const BETA: StatsAgentRow = { id: 'a-beta', name: 'Beta', enabled: true };
const IDLE: StatsAgentRow = { id: 'a-idle', name: 'Idle', enabled: false };

/** Only `priced-est` has a list price: 1e-6 USD per token. */
const estimate: Estimator = (model, i, o) => (model === 'priced-est' ? (i + o) * 1e-6 : null);

let seq = 0;
function run(
  p: Partial<Omit<DoneRunRow, 'ranAt'>> & { agentId: string | null; ranAt: string },
): DoneRunRow {
  seq += 1;
  return {
    id: `run-${seq}`,
    model: 'm1',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    durationMs: null,
    ...p,
    ranAt: new Date(p.ranAt),
  };
}

function decision(agentId: string | null, accepted: number, dismissed: number, pending = 0): DecisionRow {
  return {
    agentId,
    findings: accepted + dismissed + pending,
    accepted,
    dismissed,
    critical: 0,
    warning: 0,
    suggestion: accepted + dismissed + pending,
  };
}

function snapshot(
  window: Window,
  runs: DoneRunRow[],
  opts: { statuses?: RunStatusRow[]; decisions?: DecisionRow[]; agents?: StatsAgentRow[] } = {},
) {
  return buildSnapshot({
    window,
    agents: opts.agents ?? [ALPHA, BETA, IDLE],
    runs,
    statuses: opts.statuses ?? [],
    decisions: opts.decisions ?? [],
    estimate,
  });
}

/** A one-agent row with only decisions set (runs irrelevant to the trend rule). */
function rowWithDecisions(window: Window, accepted: number, dismissed: number) {
  return buildAgentStats(ALPHA, window, [], undefined, decision(ALPHA.id, accepted, dismissed));
}

describe('previousWindow', () => {
  it('returns the equal-length window immediately before, for presets and odd custom spans', () => {
    // 1 day (rolling 24h)
    const day = previousWindow({
      from: new Date('2026-03-02T12:00:00.000Z'),
      to: new Date('2026-03-03T12:00:00.000Z'),
    });
    expect(day.from.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(day.to.toISOString()).toBe('2026-03-02T12:00:00.000Z');

    // 30 days ending 2026-03-31 — crosses a 28-day February
    const month = previousWindow({
      from: new Date('2026-03-01T00:00:00.000Z'),
      to: new Date('2026-03-31T00:00:00.000Z'),
    });
    expect(month.from.toISOString()).toBe('2026-01-30T00:00:00.000Z');
    expect(month.to.toISOString()).toBe('2026-03-01T00:00:00.000Z');

    // Odd custom span: 55 hours
    const odd = previousWindow({
      from: new Date('2026-03-10T05:00:00.000Z'),
      to: new Date('2026-03-12T12:00:00.000Z'),
    });
    expect(odd.from.toISOString()).toBe('2026-03-07T22:00:00.000Z');
    expect(odd.to.toISOString()).toBe('2026-03-10T05:00:00.000Z');
  });
});

describe('buildAgentStats / buildSnapshot', () => {
  it('reports null (never 0) for rates, costs and timings when there is nothing to measure', () => {
    const s = snapshot(W, []);
    const idle = s.agents.find((a) => a.agent_id === IDLE.id)!;
    expect(idle.runs).toBe(0);
    expect(idle.decisions).toBe(0);
    expect(idle.accept_rate).toBeNull();
    expect(idle.dismiss_rate).toBeNull();
    expect(idle.total_cost_usd).toBeNull();
    expect(idle.avg_cost_usd).toBeNull();
    expect(idle.avg_latency_ms).toBeNull();
    expect(idle.avg_findings_per_run).toBeNull();
    expect(idle.last_run_at).toBeNull();
    expect(idle.enabled).toBe(false);

    expect(s.totals.runs).toBe(0);
    expect(s.totals.total_cost_usd).toBeNull();
    expect(s.totals.accept_rate).toBeNull();
  });

  it('excludes pending findings from decisions and the accept-rate denominator', () => {
    // 5 findings: 2 accepted, 1 dismissed, 2 pending
    const row = buildAgentStats(ALPHA, W, [], undefined, decision(ALPHA.id, 2, 1, 2));
    expect(row.findings_total).toBe(5);
    expect(row.decisions).toBe(3);
    expect(row.pending).toBe(2);
    expect(row.accept_rate).toBeCloseTo(2 / 3, 10);
    expect(row.dismiss_rate).toBeCloseTo(1 / 3, 10);
  });

  it('flags low_sample below 10 decisions and clears it at exactly 10', () => {
    expect(rowWithDecisions(W, 5, 4).low_sample).toBe(true); // 9
    expect(rowWithDecisions(W, 5, 5).low_sample).toBe(false); // 10
    expect(rowWithDecisions(W, 0, 0).low_sample).toBe(true);
  });

  it('averages cost over priced runs only, and duration over runs that recorded one', () => {
    const runs = priceRuns(
      [
        run({ agentId: ALPHA.id, ranAt: '2026-03-01T01:00:00Z', costUsd: 0.1, durationMs: 1000 }),
        run({ agentId: ALPHA.id, ranAt: '2026-03-01T02:00:00Z', costUsd: 0.2, durationMs: 3000 }),
        // estimated from tokens: (1000 + 500) × 1e-6 = 0.0015
        run({ agentId: ALPHA.id, ranAt: '2026-03-01T03:00:00Z', model: 'priced-est', tokensIn: 1000, tokensOut: 500 }),
        // no stored cost and no list price → unpriced
        run({ agentId: ALPHA.id, ranAt: '2026-03-01T04:00:00Z', model: 'unpriced-x', tokensIn: 10, tokensOut: 10 }),
      ],
      estimate,
    );
    const row = buildAgentStats(ALPHA, W, runs, undefined, undefined);
    expect(row.runs).toBe(4);
    expect(row.unpriced_runs).toBe(1);
    expect(row.total_cost_usd).toBe(0.3015);
    // (0.1 + 0.2 + 0.0015) / 3 priced runs — NOT / 4
    expect(row.avg_cost_usd).toBe(0.1005);
    expect(row.avg_latency_ms).toBe(2000);
  });

  it('keeps a stored cost verbatim instead of re-deriving it from tokens', () => {
    const [priced] = priceRuns(
      [run({ agentId: ALPHA.id, ranAt: '2026-03-01T01:00:00Z', model: 'priced-est', costUsd: 0.5, tokensIn: 1000, tokensOut: 0 })],
      estimate,
    );
    expect(priced!.cost).toBe(0.5);
  });
});

describe('cost breakdowns (AC2)', () => {
  it('total = sum of counted runs, and both breakdowns sum to it including deleted-agent and unknown-model runs', () => {
    const runs = [
      run({ agentId: ALPHA.id, ranAt: '2026-03-01T01:00:00Z', costUsd: 0.1, model: 'm1' }),
      run({ agentId: ALPHA.id, ranAt: '2026-03-02T01:00:00Z', costUsd: 0.2, model: 'm1' }),
      run({ agentId: ALPHA.id, ranAt: '2026-03-02T02:00:00Z', model: 'priced-est', tokensIn: 1000, tokensOut: 500 }),
      run({ agentId: BETA.id, ranAt: '2026-03-03T01:00:00Z', costUsd: 0.3, model: null }),
      run({ agentId: BETA.id, ranAt: '2026-03-03T02:00:00Z', model: 'unpriced-x' }),
      run({ agentId: null, ranAt: '2026-03-03T03:00:00Z', costUsd: 0.05, model: 'm2' }),
    ];
    const perf = buildPerformance(snapshot(W, runs), snapshot(PREV, []));

    expect(perf.totals.runs).toBe(6);
    expect(perf.totals.unpriced_runs).toBe(1);
    expect(perf.totals.deleted_agent_runs).toBe(1);
    expect(perf.totals.total_cost_usd).toBe(0.6515);

    const byAgent = perf.cost_by_agent.reduce((s, c) => s + c.cost_usd, 0);
    const byModel = perf.cost_by_model.reduce((s, c) => s + c.cost_usd, 0);
    expect(Math.abs(byAgent - 0.6515)).toBeLessThan(1e-6);
    expect(Math.abs(byModel - 0.6515)).toBeLessThan(1e-6);
    expect(perf.cost_by_agent.reduce((s, c) => s + c.runs, 0)).toBe(6);
    expect(perf.cost_by_model.reduce((s, c) => s + c.runs, 0)).toBe(6);

    expect(perf.cost_by_agent).toContainEqual({ key: 'deleted', label: 'Deleted agent', cost_usd: 0.05, runs: 1 });
    expect(perf.cost_by_agent).toContainEqual({ key: ALPHA.id, label: 'Alpha', cost_usd: 0.3015, runs: 3 });
    expect(perf.cost_by_model).toContainEqual({ key: 'unknown', label: 'Unknown model', cost_usd: 0.3, runs: 1 });
    // An unpriced run is still a counted run of its model, at $0
    expect(perf.cost_by_model).toContainEqual({ key: 'unpriced-x', label: 'unpriced-x', cost_usd: 0, runs: 1 });

    // The per-agent rows agree with the slices
    const alpha = perf.agents.find((a) => a.agent_id === ALPHA.id)!;
    expect(alpha.total_cost_usd).toBe(0.3015);
  });

  it('counts failed runs separately and never toward runs or cost', () => {
    const s = snapshot(
      W,
      [run({ agentId: ALPHA.id, ranAt: '2026-03-01T01:00:00Z', costUsd: 0.1 })],
      { statuses: [{ agentId: ALPHA.id, failed: 3, lastRunAt: new Date('2026-03-02T00:00:00Z') }] },
    );
    const alpha = s.agents.find((a) => a.agent_id === ALPHA.id)!;
    expect(alpha.runs).toBe(1);
    expect(alpha.failed_runs).toBe(3);
    expect(alpha.total_cost_usd).toBe(0.1);
    expect(alpha.last_run_at).toBe('2026-03-02T00:00:00.000Z');
    expect(s.totals.runs).toBe(1);
    expect(s.totals.failed_runs).toBe(3);
  });
});

describe('accept trend (AC9)', () => {
  it('is up / down by the displayed integer percentage when both windows have ≥ 10 decisions', () => {
    const up = attachComparison(rowWithDecisions(W, 8, 2), rowWithDecisions(PREV, 6, 4), PREV);
    expect(up.accept_trend).toBe('up');
    expect(up.accept_rate_delta_pp).toBe(20);
    expect(up.previous).toEqual({ runs: 0, decisions: 10, accept_rate: 0.6, low_sample: false, total_cost_usd: null });
    expect(up.previous_window).toEqual({ from: '2026-02-26T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });

    const down = attachComparison(rowWithDecisions(W, 6, 4), rowWithDecisions(PREV, 8, 2), PREV);
    expect(down.accept_trend).toBe('down');
    expect(down.accept_rate_delta_pp).toBe(-20);
  });

  it('is flat when the raw rates differ but both round to the same visible percentage', () => {
    // 70.4% vs 69.6% → both display as 70%
    const flat = attachComparison(rowWithDecisions(W, 704, 296), rowWithDecisions(PREV, 696, 304), PREV);
    expect(flat.accept_trend).toBe('flat');
    expect(flat.accept_rate_delta_pp).toBe(0);
  });

  it('is null (no arrow) when either window is low-sample, has no decisions, or the agent did not exist before', () => {
    const prevLow = attachComparison(rowWithDecisions(W, 8, 2), rowWithDecisions(PREV, 5, 4), PREV);
    expect(prevLow.accept_trend).toBeNull();
    expect(prevLow.accept_rate_delta_pp).toBeNull();

    const curLow = attachComparison(rowWithDecisions(W, 9, 0), rowWithDecisions(PREV, 8, 2), PREV);
    expect(curLow.accept_trend).toBeNull();

    const curNone = attachComparison(rowWithDecisions(W, 0, 0), rowWithDecisions(PREV, 8, 2), PREV);
    expect(curNone.accept_trend).toBeNull();
    expect(curNone.accept_rate).toBeNull();

    const noPrevRow = attachComparison(rowWithDecisions(W, 8, 2), undefined, PREV);
    expect(noPrevRow.accept_trend).toBeNull();
    expect(noPrevRow.previous).toEqual({ runs: 0, decisions: 0, accept_rate: null, low_sample: true, total_cost_usd: null });
  });
});

describe('cost delta (AC8)', () => {
  const current = [run({ agentId: ALPHA.id, ranAt: '2026-03-01T01:00:00Z', costUsd: 0.25 })];
  const previous = [run({ agentId: ALPHA.id, ranAt: '2026-02-27T01:00:00Z', costUsd: 0.4 })];

  it('is current − previous under identical rules, signed', () => {
    const lower = buildPerformance(snapshot(W, current), snapshot(PREV, previous));
    expect(lower.cost_delta_usd).toBe(-0.15);
    expect(lower.previous_totals).toEqual({ runs: 1, total_cost_usd: 0.4, decisions: 0, accept_rate: null });

    const higher = buildPerformance(
      snapshot(W, [run({ agentId: ALPHA.id, ranAt: '2026-03-01T01:00:00Z', costUsd: 0.4 })]),
      snapshot(PREV, [run({ agentId: ALPHA.id, ranAt: '2026-02-27T01:00:00Z', costUsd: 0.25 })]),
    );
    expect(higher.cost_delta_usd).toBe(0.15);
  });

  it('is null when the previous window has no counted runs', () => {
    expect(buildPerformance(snapshot(W, current), snapshot(PREV, [])).cost_delta_usd).toBeNull();
  });

  it('is null when the current window has no counted runs', () => {
    expect(buildPerformance(snapshot(W, []), snapshot(PREV, previous)).cost_delta_usd).toBeNull();
  });
});

describe('daily runs trend (AC10)', () => {
  it('zero-fills one bucket per UTC day, oldest→newest, and sums to total runs', () => {
    const runs = [
      run({ agentId: ALPHA.id, ranAt: '2026-03-01T00:00:00Z', costUsd: 0.1 }),
      run({ agentId: BETA.id, ranAt: '2026-03-01T23:59:59Z', costUsd: 0.1 }),
      run({ agentId: null, ranAt: '2026-03-03T12:00:00Z', costUsd: 0.1 }), // deleted agent still counts
    ];
    const perf = buildPerformance(snapshot(W, runs), snapshot(PREV, []));
    expect(perf.runs_trend).toEqual([
      { label: '2026-03-01', value: 2 },
      { label: '2026-03-02', value: 0 },
      { label: '2026-03-03', value: 1 },
    ]);
    expect(perf.runs_trend.reduce((s, p) => s + p.value, 0)).toBe(perf.totals.runs);

    const alpha = perf.agents.find((a) => a.agent_id === ALPHA.id)!;
    expect(alpha.trend.map((p) => p.value)).toEqual([1, 0, 0]);
  });

  it('does not open a bucket for the exclusive end instant', () => {
    expect(zeroFillDailyUtc(W, []).map((p) => p.label)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
  });
});

describe('most active agent (AC3)', () => {
  function rows(spec: Array<{ agent: StatsAgentRow; runs: number; last: string | null }>) {
    return spec.map(({ agent, runs, last }) => {
      const priced = priceRuns(
        Array.from({ length: runs }, () => run({ agentId: agent.id, ranAt: '2026-03-01T01:00:00Z', costUsd: 0.01 })),
        estimate,
      );
      const status = last ? { agentId: agent.id, failed: 0, lastRunAt: new Date(last) } : undefined;
      return attachComparison(buildAgentStats(agent, W, priced, status, undefined), undefined, PREV);
    });
  }

  it('picks the most runs; ties go to the later last run, then name A→Z; null when nobody ran', () => {
    expect(
      pickMostActive(rows([
        { agent: ALPHA, runs: 2, last: '2026-03-03T00:00:00Z' },
        { agent: BETA, runs: 3, last: '2026-03-01T00:00:00Z' },
      ]))?.agent_name,
    ).toBe('Beta');

    expect(
      pickMostActive(rows([
        { agent: ALPHA, runs: 2, last: '2026-03-01T00:00:00Z' },
        { agent: BETA, runs: 2, last: '2026-03-02T00:00:00Z' },
      ]))?.agent_name,
    ).toBe('Beta');

    expect(
      pickMostActive(rows([
        { agent: BETA, runs: 2, last: '2026-03-02T00:00:00Z' },
        { agent: ALPHA, runs: 2, last: '2026-03-02T00:00:00Z' },
      ]))?.agent_name,
    ).toBe('Alpha');

    expect(pickMostActive(rows([{ agent: IDLE, runs: 0, last: null }]))).toBeNull();
  });
});
