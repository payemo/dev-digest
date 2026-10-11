import type { CiRunStatus } from "@devdigest/shared";

/** Time-window choices (days) and their label keys under `ci.runs.filters`. */
export const DAY_OPTIONS: readonly { days: number; labelKey: string }[] = [
  { days: 1, labelKey: "runs.filters.last1Day" },
  { days: 7, labelKey: "runs.filters.last7Days" },
  { days: 30, labelKey: "runs.filters.last30Days" },
  { days: 90, labelKey: "runs.filters.last90Days" },
];
export const DEFAULT_DAYS = 7;

export const STATUS_OPTIONS: readonly CiRunStatus[] = ["succeeded", "no_findings", "failed", "running"];

/** i18n key suffix per status (`ci.runs.status.*`). */
export const STATUS_LABEL_KEY: Record<CiRunStatus, string> = {
  succeeded: "succeeded",
  no_findings: "noFindings",
  failed: "failed",
  running: "running",
};

/** Table grid: time · repo · PR · agent · verdict · findings · cost · duration · status · job. */
export const GRID = "130px 1.3fr 70px 1.1fr 130px 80px 80px 80px 150px 90px";
