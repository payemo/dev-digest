import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - AgentPerformance     every agent's AgentStats + totals (GET /agent-performance)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// NOTE: the Multi-Agent Review shapes below are unused; new code uses
// `contracts/multi-agent.ts` (MultiAgentRunView, MultiAgentColumn, DisagreementRow, …).
// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

/** Longest window either stats endpoint accepts, in days. */
const MAX_STATS_WINDOW_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A half-open `[from, to)` window on `agent_runs.ran_at`, ISO-8601 with offset. */
export const StatsWindow = z.object({ from: z.string(), to: z.string() });
export type StatsWindow = z.infer<typeof StatsWindow>;

/**
 * Query of `GET /agents/:id/stats` and `GET /agent-performance`. Both take the
 * same explicit window so a dashboard row and a Stats tab can never disagree.
 * `from < to`, and the span is at most 366 days.
 */
export const StatsWindowQuery = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: '`from` must be before `to`',
    path: ['from'],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= MAX_STATS_WINDOW_DAYS * DAY_MS, {
    message: `The window may span at most ${MAX_STATS_WINDOW_DAYS} days`,
    path: ['to'],
  });
export type StatsWindowQuery = z.infer<typeof StatsWindowQuery>;

/**
 * Where a cost figure comes from. Only `'estimate'` exists: there is no
 * reconciled billing data. `agent_runs.cost_usd` mixes a provider-reported
 * cost (OpenRouter's `usage.cost`) with price-table estimates written by other
 * adapters, and a null column is derived on read from tokens × list price.
 */
export const CostBasis = z.literal('estimate');
export type CostBasis = z.infer<typeof CostBasis>;

/** Direction of an agent's accept rate vs the previous equal-length window. */
export const AcceptTrend = z.enum(['up', 'down', 'flat']);
export type AcceptTrend = z.infer<typeof AcceptTrend>;

/** The same agent's headline figures over the previous equal-length window. */
export const PeriodComparison = z.object({
  runs: z.number().int(),
  decisions: z.number().int(),
  accept_rate: z.number().nullable(),
  low_sample: z.boolean(),
  total_cost_usd: z.number().nullable(),
});
export type PeriodComparison = z.infer<typeof PeriodComparison>;

/**
 * Per-agent aggregates over one window. Counted runs are `status = 'done'`
 * (local and CI alike); failed/cancelled runs only feed `failed_runs` and
 * `last_run_at`.
 */
export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  enabled: z.boolean(),
  window: StatsWindow,
  previous_window: StatsWindow,
  runs: z.number().int(),
  failed_runs: z.number().int(),
  /** Done runs whose cost could not be priced (no stored cost, unpriced model). */
  unpriced_runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  /** accepted + dismissed — the accept-rate denominator. Pending is excluded. */
  decisions: z.number().int(),
  /** accepted / decisions, 0..1; null when decisions = 0 (never 0 for "no data"). */
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  /** decisions < the server's ranking threshold — don't rank or trend on it. */
  low_sample: z.boolean(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  /** Priced cost / priced runs; null when no run is priced. */
  avg_cost_usd: z.number().nullable(),
  /** Average `duration_ms` over done runs that recorded one. */
  avg_latency_ms: z.number().nullable(),
  last_run_at: z.string().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** Done runs per UTC day in the window, zero-filled, oldest→newest. */
  trend: z.array(StatPoint),
  previous: PeriodComparison,
  /**
   * Evidence-gated: null unless BOTH windows have enough decisions. Compares
   * the displayed integer percentages, so it never contradicts two equal ones.
   */
  accept_trend: AcceptTrend.nullable(),
  /** round(current %) − round(previous %); null whenever `accept_trend` is. */
  accept_rate_delta_pp: z.number().int().nullable(),
  cost_basis: CostBasis,
});
export type AgentStats = z.infer<typeof AgentStats>;

/** One slice of a cost breakdown (by agent or by model). */
export const CostSlice = z.object({
  key: z.string(),
  label: z.string(),
  cost_usd: z.number(),
  runs: z.number().int(),
});
export type CostSlice = z.infer<typeof CostSlice>;

/**
 * Response of `GET /agent-performance`: every workspace agent's `AgentStats`
 * for the window, plus totals and breakdowns built from the same rows.
 */
export const AgentPerformance = z.object({
  window: StatsWindow,
  previous_window: StatsWindow,
  cost_basis: CostBasis,
  min_decisions_for_ranking: z.number().int(),
  totals: z.object({
    runs: z.number().int(),
    failed_runs: z.number().int(),
    unpriced_runs: z.number().int(),
    /** Done runs whose agent has since been deleted (`agent_id` is null). */
    deleted_agent_runs: z.number().int(),
    total_cost_usd: z.number().nullable(),
    accepted: z.number().int(),
    dismissed: z.number().int(),
    decisions: z.number().int(),
    /** Pooled Σaccepted / Σdecisions; null when Σdecisions = 0. */
    accept_rate: z.number().nullable(),
  }),
  previous_totals: z.object({
    runs: z.number().int(),
    total_cost_usd: z.number().nullable(),
    decisions: z.number().int(),
    accept_rate: z.number().nullable(),
  }),
  /** Current − previous total cost; null when either window has no counted runs. */
  cost_delta_usd: z.number().nullable(),
  most_active: z
    .object({
      agent_id: z.string(),
      agent_name: z.string(),
      runs: z.number().int(),
      accept_rate: z.number().nullable(),
      decisions: z.number().int(),
    })
    .nullable(),
  agents: z.array(AgentStats),
  cost_by_agent: z.array(CostSlice),
  cost_by_model: z.array(CostSlice),
  /** Done runs per UTC day across the workspace; sums to `totals.runs`. */
  runs_trend: z.array(StatPoint),
});
export type AgentPerformance = z.infer<typeof AgentPerformance>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
