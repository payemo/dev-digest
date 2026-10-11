/* ci-status.ts — pure helpers for a CI run status, shared by the agent's CI tab
   and the CI Runs page. */
import type { CiRunStatus } from "@devdigest/shared";

const RUN_STATUSES: readonly CiRunStatus[] = ["succeeded", "failed", "no_findings", "running"];

/** Colour token pair for a run status chip. */
export function statusTone(status: CiRunStatus): { color: string; bg: string } {
  if (status === "failed") return { color: "var(--crit)", bg: "var(--crit-bg)" };
  if (status === "running") return { color: "var(--info)", bg: "var(--info-bg)" };
  return { color: "var(--ok)", bg: "var(--ok-bg)" };
}

/** Narrow a stored run status string to the contract enum (null if unknown). */
export function runStatusOf(status: string | null | undefined): CiRunStatus | null {
  return RUN_STATUSES.find((x) => x === status) ?? null;
}
