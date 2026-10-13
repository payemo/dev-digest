import type { AgentStats } from "@devdigest/shared";

export type SortKey = "runs" | "avgCost" | "accept" | "lastRun";
export type SortDir = "asc" | "desc";

/**
 * Accept-sort tier — the same in both directions:
 *   0 enough decisions (ranked by rate) · 1 low sample · 2 no runs at all.
 */
function acceptTier(row: AgentStats): number {
  if (row.runs === 0) return 2;
  if (row.low_sample || row.accept_rate === null) return 1;
  return 0;
}

function lastRunMs(row: AgentStats): number | null {
  return row.last_run_at ? Date.parse(row.last_run_at) : null;
}

/** Nulls sort last whichever way the column is sorted. */
function compareNullable(a: number | null, b: number | null, sign: number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * sign;
}

/**
 * Sort table rows. Accept sort ranks only agents with enough decisions by
 * rate; low-sample agents follow (most decisions first), then agents with no
 * runs — in both directions, so a 1-of-1 agent never tops the ranking.
 */
export function sortRows(rows: AgentStats[], key: SortKey, dir: SortDir): AgentStats[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: AgentStats, b: AgentStats) => a.agent_name.localeCompare(b.agent_name);
  return [...rows].sort((a, b) => {
    switch (key) {
      case "runs":
        return (a.runs - b.runs) * sign || byName(a, b);
      case "avgCost":
        return compareNullable(a.avg_cost_usd, b.avg_cost_usd, sign) || byName(a, b);
      case "lastRun":
        return compareNullable(lastRunMs(a), lastRunMs(b), sign) || byName(a, b);
      case "accept": {
        const tier = acceptTier(a) - acceptTier(b);
        if (tier !== 0) return tier;
        if (acceptTier(a) === 0) return ((a.accept_rate ?? 0) - (b.accept_rate ?? 0)) * sign || byName(a, b);
        return b.decisions - a.decisions || byName(a, b);
      }
    }
  });
}
