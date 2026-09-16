/**
 * Shared USD/token formatters for the Run Cost Badge — the 4 spots (PR-list
 * COST column, timeline row, trace-drawer Stats tile, VerdictBanner usage
 * line) all need the same numbers to read the same way.
 */

/**
 * USD for display. Review runs cost fractions of a cent, PR totals can reach
 * dollars, so precision scales with magnitude:
 *   null/NaN → "—"   0 → "$0.00"   0.0013 → "$0.0013"   0.014 → "$0.014"
 *   12.4 → "$12.40"   0.00002 → "<$0.0001"
 */
export function formatUsd(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0.00";
  const abs = Math.abs(usd);
  if (abs < 0.0001) return "<$0.0001"; // never render a misleading "$0.0000"
  if (abs < 0.01) return `$${usd.toFixed(4)}`;
  if (abs < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Grouped token count for prose, e.g. 9119 → "9,119". Locale pinned so jsdom
 *  tests and the browser render the same string. */
export function formatTokenCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Compact in→out token pair for the verdict banner, e.g. "8.2K→1.3K". */
export function formatTokensCompact(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(1)}K→${(tokensOut / 1000).toFixed(1)}K`;
}
