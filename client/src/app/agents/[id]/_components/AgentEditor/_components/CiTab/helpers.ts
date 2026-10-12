import type { CiInstallation, CiRunStatus } from "@devdigest/shared";

/** Compact relative time ("4m ago", "1h ago"); "—" when unknown. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((now - then) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * What the installation row shows for its last run. An unverified run (the
 * repo's files differ from the installed version) never counts as a success.
 */
export type LastRunView =
  | { kind: "none" }
  | { kind: "unverified"; ranAt: string | null }
  | { kind: "status"; status: CiRunStatus; ranAt: string | null };

export function lastRunView(inst: CiInstallation): LastRunView {
  const run = inst.last_run;
  if (!run) return { kind: "none" };
  if (run.verification === "unverified") return { kind: "unverified", ranAt: run.ran_at };
  return { kind: "status", status: run.status, ranAt: run.ran_at };
}
