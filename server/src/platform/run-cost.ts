/**
 * Run-cost policy: what a single run cost, and what a PR's runs cost in total.
 *
 * Pure and DB-free by design — it lives in `platform/` (not a `modules/reviews`
 * helper) because `pulls/routes.ts` needs it too, and there are no relative
 * imports between sibling `modules/*`; they only share via `platform/` and
 * `modules/_shared/`.
 */

/** Same shape as `PriceBook.estimate` — USD, or null for an unpriced model. */
export type Estimator = (model: string, tokensIn: number, tokensOut: number) => number | null;

/** The minimum an `agent_runs` row must expose to be priced. */
export interface RunCostInputs {
  costUsd: number | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * Effective USD cost of ONE run.
 *   provider-reported cost  → return it verbatim (NEVER re-derive — that's
 *                             the double-count trap: once a derived number is
 *                             persisted, a later read can't tell it from a
 *                             billed one)
 *   no cost, no model       → null (honest unknown)
 *   no cost, unpriced model → null
 *   no cost, priced model   → derive from tokens. Zero extra model calls.
 */
export function effectiveRunCost(row: RunCostInputs, estimate: Estimator): number | null {
  if (row.costUsd != null) return row.costUsd;
  if (!row.model) return null;
  return estimate(row.model, row.tokensIn ?? 0, row.tokensOut ?? 0);
}

/**
 * Total USD cost across a PR's runs. ALWAYS a number: a run whose model isn't
 * priced contributes 0 (never breaks the sum), and an empty list is 0 — so the
 * PR list always shows "$0.00" for a PR with no cost data, never a dash.
 * Rounded to 1e-6 so repeated float addition doesn't leak as 0.43000000000000005.
 */
export function sumRunCosts(rows: RunCostInputs[], estimate: Estimator): number {
  const total = rows.reduce((sum, row) => sum + (effectiveRunCost(row, estimate) ?? 0), 0);
  return Math.round(total * 1e6) / 1e6;
}
