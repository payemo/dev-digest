import type { AgentStats } from "@devdigest/shared";
import { ACCEPT_OK_MIN, ACCEPT_WARN_MIN } from "./constants";

/** Colour for a displayed accept %; null (no colour) for a low-sample row. */
export function acceptColor(row: AgentStats, pct: number): string | null {
  if (row.low_sample) return null;
  if (pct >= ACCEPT_OK_MIN) return "var(--ok)";
  if (pct >= ACCEPT_WARN_MIN) return "var(--warn)";
  return "var(--crit)";
}
