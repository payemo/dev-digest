/**
 * Pure helpers for PrBriefCard. No `react` import — deriving lives here; which
 * hook runs and what happens on click is the component's job.
 */
import type { BriefInputs, ReviewRecord, Verdict } from "@devdigest/shared";
import { INPUT_ORDER } from "./constants";

export interface LatestReviewSummary {
  verdict: Verdict;
  score: number | null;
  findingsCount: number;
  blockers: number;
}

/**
 * The verdict banner's review data: the newest review with a verdict (the list
 * is newest-first). Blockers are CRITICAL findings not dismissed — the same
 * rule the Findings tab's accordion uses. `null` when nothing has a verdict.
 */
export function latestReviewSummary(
  reviews: ReviewRecord[] | undefined,
): LatestReviewSummary | null {
  const review = reviews?.find((r) => r.verdict != null);
  if (!review || !review.verdict) return null;
  return {
    verdict: review.verdict,
    score: review.score,
    findingsCount: review.findings.length,
    blockers: review.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length,
  };
}

/**
 * A risk file ref (`path`, `path:line`, `path:start-end`) → its path and start
 * line. The line is `null` when absent.
 */
export function parseRef(ref: string): { path: string; line: number | null } {
  const m = ref.trim().match(/^(.*?):(\d+)(?:-\d+)?$/);
  if (m && m[1]) return { path: m[1], line: Number(m[2]) };
  return { path: ref.trim(), line: null };
}

/** Which inputs were missing, and which were only partial or outdated. */
export function inputGaps(inputs: BriefInputs): {
  missing: (keyof BriefInputs)[];
  partial: (keyof BriefInputs)[];
} {
  const missing: (keyof BriefInputs)[] = [];
  const partial: (keyof BriefInputs)[] = [];
  for (const key of INPUT_ORDER) {
    if (inputs[key] === "missing") missing.push(key);
    else if (inputs[key] === "partial" || inputs[key] === "stale") partial.push(key);
  }
  return { missing, partial };
}
