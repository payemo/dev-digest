/* Multi-Agent Review route helpers — pure, no React. */
import type { IconName } from "@devdigest/ui";
import type { MultiAgentCandidate } from "@devdigest/shared";
import { formatUsd } from "@/lib/format";
import {
  AGENT_IDENTITY_BGS,
  AGENT_IDENTITY_COLORS,
  AGENT_IDENTITY_ICONS,
  PARAM,
  type ResultView,
} from "./constants";

export interface AgentIdentity {
  color: string;
  bg: string;
  icon: IconName;
}

/** Small stable string hash (djb2) — same input, same bucket, every render. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic identity colour + icon for an agent (by id, else name). */
export function agentIdentity(agentId: string | null, name: string | null): AgentIdentity {
  const h = hash(agentId ?? name ?? "");
  const colorIdx = h % AGENT_IDENTITY_COLORS.length;
  return {
    color: AGENT_IDENTITY_COLORS[colorIdx]!,
    bg: AGENT_IDENTITY_BGS[colorIdx]!,
    icon: AGENT_IDENTITY_ICONS[Math.floor(h / AGENT_IDENTITY_COLORS.length) % AGENT_IDENTITY_ICONS.length]!,
  };
}

export interface SelectionTotals {
  /** Agents run in parallel: the slowest known estimate. */
  durationMs: number | null;
  /** Sum of known cost estimates. */
  costUsd: number | null;
  /** True when any ticked agent lacks an estimate (or one of its fields). */
  partial: boolean;
}

/** Totals for the ticked candidates' estimates. */
export function selectionTotals(
  candidates: MultiAgentCandidate[],
  tickedIds: ReadonlySet<string> | readonly string[],
): SelectionTotals {
  const ticked = new Set(tickedIds);
  let durationMs: number | null = null;
  let costUsd: number | null = null;
  let partial = false;
  for (const c of candidates) {
    if (!ticked.has(c.agent_id)) continue;
    const e = c.estimate;
    if (e.sample_size === 0 || e.avg_duration_ms == null || e.avg_cost_usd == null) partial = true;
    if (e.avg_duration_ms != null) durationMs = Math.max(durationMs ?? 0, e.avg_duration_ms);
    if (e.avg_cost_usd != null) costUsd = Math.round(((costUsd ?? 0) + e.avg_cost_usd) * 1e6) / 1e6;
  }
  return { durationMs, costUsd, partial };
}

/**
 * A cost ESTIMATE for display, cents precision ($0.20, $0.06) — an average is
 * not a bill, so the extra digits `formatUsd` shows for real run costs would
 * be false precision. Sub-cent estimates fall back to `formatUsd`.
 */
export function formatCostEstimate(usd: number | null | undefined): string | null {
  if (usd == null || !Number.isFinite(usd)) return null;
  if (usd !== 0 && Math.abs(usd) < 0.01) return formatUsd(usd);
  return `$${usd.toFixed(2)}`;
}

/** The results view mode from `?view=` — Columns unless explicitly Tabs. */
export function readView(search: URLSearchParams): ResultView {
  return search.get(PARAM.view) === "tabs" ? "tabs" : "columns";
}

/** A copy of `search` with each key set (string) or removed (null). */
export function withParams(
  search: URLSearchParams,
  updates: Partial<Record<keyof typeof PARAM, string | null>>,
): URLSearchParams {
  const sp = new URLSearchParams(search.toString());
  for (const [key, val] of Object.entries(updates)) {
    if (val == null) sp.delete(key);
    else sp.set(key, val);
  }
  return sp;
}
