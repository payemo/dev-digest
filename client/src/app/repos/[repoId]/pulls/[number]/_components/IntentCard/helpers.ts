/**
 * Pure helpers for IntentCard. No `react` import — that is the test for
 * whether something belongs in this file.
 */

export type ConfidenceBand = "high" | "medium" | "low";

/**
 * The SAME thresholds the server uses when it picks the caveat line for the
 * reviewer prompt (`reviewer-core/src/prompt.ts`) and when it logs the band —
 * high ≥ 0.70, medium 0.40-0.69, low < 0.40. The number itself is computed
 * server-side from the recorded evidence; this only maps it to a band.
 */
export function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}

/**
 * `sources` is the audit trail behind the confidence number, as raw markers
 * (`spec:docs/plans/x.md`, `issue:482`, `body`, `ticket_ref_unreadable`).
 * Render the marker's kind, deduped and in the order recorded — the full
 * `spec:<path>` is too long for a footer line and the path adds nothing there.
 */
export function sourceKinds(sources: string[]): string[] {
  const kinds = sources.map((s) => s.split(":")[0] ?? s);
  return [...new Set(kinds)];
}

/** Whole-percent form of the 0-1 confidence, for the `{tokens} tok` style footer. */
export function tokenTotal(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): number | null {
  if (tokensIn == null && tokensOut == null) return null;
  return (tokensIn ?? 0) + (tokensOut ?? 0);
}

/** `$0.0003`, or a dash when the model is unpriced (server sends null). */
export function formatCost(costUsd: number | null | undefined): string {
  return costUsd == null ? "—" : `$${costUsd.toFixed(4)}`;
}
