import type {
  AcceptTrend,
  AgentPerformance,
  AgentStats,
  CostSlice,
  PeriodComparison,
  StatPoint,
  StatsWindow,
} from '@devdigest/shared';
import { effectiveRunCost, type Estimator } from '../../platform/run-cost.js';
import {
  DELETED_AGENT_KEY,
  DELETED_AGENT_LABEL,
  MIN_DECISIONS_FOR_RANKING,
  UNKNOWN_MODEL_KEY,
  UNKNOWN_MODEL_LABEL,
} from './constants.js';
import type { DecisionRow, DoneRunRow, RunStatusRow, StatsAgentRow } from './repository.js';

/**
 * Pure aggregation rules for agent stats — data in, data out. Both endpoints
 * (one agent's Stats tab and the workspace dashboard) go through
 * `buildSnapshot` + `attachComparison`, and the previous window goes through
 * the exact same functions, so the figures can't drift between them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A half-open `[from, to)` window. */
export interface Window {
  from: Date;
  to: Date;
}

/** A done run with its effective cost (null = unpriced). */
export interface PricedRun extends DoneRunRow {
  cost: number | null;
}

/** An agent's row before the previous-window comparison is attached. */
export type CurrentAgentStats = Omit<
  AgentStats,
  'previous_window' | 'previous' | 'accept_trend' | 'accept_rate_delta_pp'
>;

type Totals = AgentPerformance['totals'];

/** One window's worth of aggregates: per-agent rows, the priced run list, totals. */
export interface WindowSnapshot {
  window: Window;
  agents: CurrentAgentStats[];
  priced: PricedRun[];
  totals: Totals;
}

export interface SnapshotInput {
  window: Window;
  agents: StatsAgentRow[];
  runs: DoneRunRow[];
  statuses: RunStatusRow[];
  decisions: DecisionRow[];
  estimate: Estimator;
}

/** Same 1e-6 rounding `sumRunCosts` applies, so float addition doesn't leak. */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function toWire(w: Window): StatsWindow {
  return { from: w.from.toISOString(), to: w.to.toISOString() };
}

/** The equal-length window immediately before: `[from − (to − from), from)`. */
export function previousWindow(w: Window): Window {
  const span = w.to.getTime() - w.from.getTime();
  return { from: new Date(w.from.getTime() - span), to: new Date(w.from.getTime()) };
}

/** `accepted / decisions`; null when there are no decisions (never 0 for "no data"). */
export function pooledAcceptRate(accepted: number, decisions: number): number | null {
  return decisions > 0 ? accepted / decisions : null;
}

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Count per UTC day covering `[from, to)`, oldest→newest, zero-filled. */
export function zeroFillDailyUtc(window: Window, ranAts: Date[]): StatPoint[] {
  const first = utcDay(window.from);
  const last = utcDay(new Date(window.to.getTime() - 1));
  const counts = new Map<number, number>();
  for (let day = first; day <= last; day += DAY_MS) counts.set(day, 0);
  for (const at of ranAts) {
    const day = utcDay(at);
    const n = counts.get(day);
    if (n !== undefined) counts.set(day, n + 1);
  }
  return [...counts].map(([day, value]) => ({
    label: new Date(day).toISOString().slice(0, 10),
    value,
  }));
}

export function priceRuns(runs: DoneRunRow[], estimate: Estimator): PricedRun[] {
  return runs.map((r) => ({ ...r, cost: effectiveRunCost(r, estimate) }));
}

/** Unpriced runs contribute 0; an empty list is null, never `$0`. */
function totalCost(runs: PricedRun[]): number | null {
  if (runs.length === 0) return null;
  return round6(runs.reduce((sum, r) => sum + (r.cost ?? 0), 0));
}

function groupBy<K, V>(items: V[], key: (v: V) => K): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** One agent's figures over one window. */
export function buildAgentStats(
  agent: StatsAgentRow,
  window: Window,
  runs: PricedRun[],
  status: RunStatusRow | undefined,
  decision: DecisionRow | undefined,
): CurrentAgentStats {
  const findingsTotal = decision?.findings ?? 0;
  const accepted = decision?.accepted ?? 0;
  const dismissed = decision?.dismissed ?? 0;
  const decisions = accepted + dismissed;

  const priced = runs.filter((r) => r.cost !== null);
  const pricedSum = priced.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const durations = runs.flatMap((r) => (r.durationMs === null ? [] : [r.durationMs]));

  return {
    agent_id: agent.id,
    agent_name: agent.name,
    enabled: agent.enabled,
    window: toWire(window),
    runs: runs.length,
    failed_runs: status?.failed ?? 0,
    unpriced_runs: runs.length - priced.length,
    findings_total: findingsTotal,
    accepted,
    dismissed,
    pending: findingsTotal - decisions,
    decisions,
    accept_rate: pooledAcceptRate(accepted, decisions),
    dismiss_rate: decisions > 0 ? dismissed / decisions : null,
    low_sample: decisions < MIN_DECISIONS_FOR_RANKING,
    avg_findings_per_run: runs.length > 0 ? findingsTotal / runs.length : null,
    total_cost_usd: totalCost(runs),
    avg_cost_usd: priced.length > 0 ? round6(pricedSum / priced.length) : null,
    avg_latency_ms:
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
    last_run_at: status?.lastRunAt ? status.lastRunAt.toISOString() : null,
    findings_by_severity: {
      CRITICAL: decision?.critical ?? 0,
      WARNING: decision?.warning ?? 0,
      SUGGESTION: decision?.suggestion ?? 0,
    },
    trend: zeroFillDailyUtc(
      window,
      runs.map((r) => r.ranAt),
    ),
    cost_basis: 'estimate',
  };
}

/**
 * Every agent row plus workspace totals for one window. Totals span every
 * done run in the window — deleted agents' runs included — so the daily trend
 * and both cost breakdowns sum to them.
 */
export function buildSnapshot(input: SnapshotInput): WindowSnapshot {
  const priced = priceRuns(input.runs, input.estimate);
  const runsByAgent = groupBy(priced, (r) => r.agentId);
  const statusByAgent = new Map(input.statuses.map((s) => [s.agentId, s]));
  const decisionByAgent = new Map(input.decisions.map((d) => [d.agentId, d]));

  const agents = input.agents.map((a) =>
    buildAgentStats(
      a,
      input.window,
      runsByAgent.get(a.id) ?? [],
      statusByAgent.get(a.id),
      decisionByAgent.get(a.id),
    ),
  );

  const accepted = input.decisions.reduce((sum, d) => sum + d.accepted, 0);
  const dismissed = input.decisions.reduce((sum, d) => sum + d.dismissed, 0);
  const decisions = accepted + dismissed;

  return {
    window: input.window,
    agents,
    priced,
    totals: {
      runs: priced.length,
      failed_runs: input.statuses.reduce((sum, s) => sum + s.failed, 0),
      unpriced_runs: priced.filter((r) => r.cost === null).length,
      deleted_agent_runs: priced.filter((r) => r.agentId === null).length,
      total_cost_usd: totalCost(priced),
      accepted,
      dismissed,
      decisions,
      accept_rate: pooledAcceptRate(accepted, decisions),
    },
  };
}

function comparisonOf(row: CurrentAgentStats | undefined): PeriodComparison {
  if (!row) {
    return { runs: 0, decisions: 0, accept_rate: null, low_sample: true, total_cost_usd: null };
  }
  return {
    runs: row.runs,
    decisions: row.decisions,
    accept_rate: row.accept_rate,
    low_sample: row.low_sample,
    total_cost_usd: row.total_cost_usd,
  };
}

/**
 * Fill in the previous-window comparison. The trend is defined only when BOTH
 * windows have enough decisions, and compares the displayed integer
 * percentages — so an arrow never contradicts two identical visible values.
 */
export function attachComparison(
  current: CurrentAgentStats,
  previous: CurrentAgentStats | undefined,
  prevWindow: Window,
): AgentStats {
  const prev = comparisonOf(previous);
  let acceptTrend: AcceptTrend | null = null;
  let deltaPp: number | null = null;
  if (
    !current.low_sample &&
    !prev.low_sample &&
    current.accept_rate !== null &&
    prev.accept_rate !== null
  ) {
    const cur = Math.round(current.accept_rate * 100);
    const before = Math.round(prev.accept_rate * 100);
    deltaPp = cur - before;
    acceptTrend = deltaPp > 0 ? 'up' : deltaPp < 0 ? 'down' : 'flat';
  }
  return {
    ...current,
    previous_window: toWire(prevWindow),
    previous: prev,
    accept_trend: acceptTrend,
    accept_rate_delta_pp: deltaPp,
  };
}

/** Most runs; ties → later last run, then name A→Z. Null when nobody ran. */
export function pickMostActive(rows: AgentStats[]): AgentPerformance['most_active'] {
  const ran = rows.filter((r) => r.runs > 0);
  if (ran.length === 0) return null;
  const [top] = [...ran].sort(
    (a, b) =>
      b.runs - a.runs ||
      (b.last_run_at ?? '').localeCompare(a.last_run_at ?? '') ||
      a.agent_name.localeCompare(b.agent_name),
  );
  return {
    agent_id: top!.agent_id,
    agent_name: top!.agent_name,
    runs: top!.runs,
    accept_rate: top!.accept_rate,
    decisions: top!.decisions,
  };
}

function slices(
  groups: Map<string, PricedRun[]>,
  labelOf: (key: string) => string,
): CostSlice[] {
  return [...groups]
    .map(([key, runs]) => ({
      key,
      label: labelOf(key),
      cost_usd: round6(runs.reduce((sum, r) => sum + (r.cost ?? 0), 0)),
      runs: runs.length,
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd || a.label.localeCompare(b.label));
}

/** The dashboard response, from the current and previous window snapshots. */
export function buildPerformance(
  current: WindowSnapshot,
  previous: WindowSnapshot,
  minDecisions: number = MIN_DECISIONS_FOR_RANKING,
): AgentPerformance {
  const prevByAgent = new Map(previous.agents.map((a) => [a.agent_id, a]));
  const agents = current.agents.map((a) =>
    attachComparison(a, prevByAgent.get(a.agent_id), previous.window),
  );

  const names = new Map(current.agents.map((a) => [a.agent_id, a.agent_name]));
  const byAgent = groupBy(current.priced, (r) => r.agentId ?? DELETED_AGENT_KEY);
  const byModel = groupBy(current.priced, (r) => r.model ?? UNKNOWN_MODEL_KEY);

  const cur = current.totals.total_cost_usd;
  const prev = previous.totals.total_cost_usd;

  return {
    window: toWire(current.window),
    previous_window: toWire(previous.window),
    cost_basis: 'estimate',
    min_decisions_for_ranking: minDecisions,
    totals: current.totals,
    previous_totals: {
      runs: previous.totals.runs,
      total_cost_usd: previous.totals.total_cost_usd,
      decisions: previous.totals.decisions,
      accept_rate: previous.totals.accept_rate,
    },
    cost_delta_usd: cur !== null && prev !== null ? round6(cur - prev) : null,
    most_active: pickMostActive(agents),
    agents,
    cost_by_agent: slices(byAgent, (key) =>
      key === DELETED_AGENT_KEY ? DELETED_AGENT_LABEL : (names.get(key) ?? DELETED_AGENT_LABEL),
    ),
    cost_by_model: slices(byModel, (key) =>
      key === UNKNOWN_MODEL_KEY ? UNKNOWN_MODEL_LABEL : key,
    ),
    runs_trend: zeroFillDailyUtc(
      current.window,
      current.priced.map((r) => r.ranAt),
    ),
  };
}
