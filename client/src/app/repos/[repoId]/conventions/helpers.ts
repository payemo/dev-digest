import type { ConventionCandidate } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import type { ConventionFilter } from "./constants";

export interface StatusCounts {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

/** Tally by status — the source for both the filter chip counts and the "Create skill" gate. */
export function countByStatus(candidates: ConventionCandidate[]): StatusCounts {
  const counts: StatusCounts = { pending: 0, approved: 0, rejected: 0, total: candidates.length };
  for (const c of candidates) counts[c.status] += 1;
  return counts;
}

/** `all` shows everything; every other filter is an exact status match. */
export function filterCandidates(
  candidates: ConventionCandidate[],
  filter: ConventionFilter,
): ConventionCandidate[] {
  return filter === "all" ? candidates : candidates.filter((c) => c.status === filter);
}

/** 0..1 confidence → a rounded percentage; a missing confidence reads as 0, never crashes the bar. */
export function confidencePercent(confidence: number | null): number {
  return Math.round(Math.max(0, Math.min(1, confidence ?? 0)) * 100);
}

/**
 * Deep-link a candidate's evidence to the exact line on GitHub, pinned to the
 * repo's default branch (the closest thing to a stable ref this page has —
 * there is no per-scan commit sha to pin to).
 */
export function evidenceGithubUrl(
  repoFullName: string,
  defaultBranch: string,
  candidate: Pick<ConventionCandidate, "evidence_path" | "evidence_line">,
): string | null {
  if (!candidate.evidence_path || !repoFullName) return null;
  return githubBlobUrl(
    repoFullName,
    defaultBranch,
    candidate.evidence_path,
    candidate.evidence_line ?? undefined,
  );
}

/** `src/api/users.ts:23` — how the card and the skill draft both cite evidence. */
export function evidenceLabel(candidate: Pick<ConventionCandidate, "evidence_path" | "evidence_line">): string {
  if (!candidate.evidence_path) return "";
  return candidate.evidence_line
    ? `${candidate.evidence_path}:${candidate.evidence_line}`
    : candidate.evidence_path;
}
