/* Pure helpers for the agent Evals tab. */
import type { EvalCaseRecord } from "@devdigest/shared";

/** "<passing> / <with a result> passing": cases whose last result passed, over cases with any result. */
export function passingCounts(cases: EvalCaseRecord[]): { passing: number; withResult: number } {
  const withResult = cases.filter((c) => c.last_result != null);
  return {
    passing: withResult.filter((c) => c.last_result!.status === "passed").length,
    withResult: withResult.length,
  };
}

/** The "severity · category" chip of a must_find case (first expectation), or null for assert-empty. */
export function expectationChip(c: EvalCaseRecord): string | null {
  if (c.kind !== "must_find") return null;
  const first = c.expected_output[0];
  return first ? `${first.severity} · ${first.category}` : null;
}
