import type { CiRun, CiRunsQueryInput, CiVerdict } from "@devdigest/shared";
import { githubPrUrl } from "@/lib/github-urls";
import { DEFAULT_DAYS, STATUS_OPTIONS } from "./constants";

/** The runs query mirrored in the URL (`?days=&agent_id=&repo=&status=`). */
export function queryFromParams(params: URLSearchParams): CiRunsQueryInput {
  const days = Number(params.get("days"));
  const status = params.get("status");
  return {
    days: Number.isInteger(days) && days >= 1 && days <= 90 ? days : DEFAULT_DAYS,
    agent_id: params.get("agent_id") || undefined,
    repo: params.get("repo") || undefined,
    status: STATUS_OPTIONS.find((x) => x === status),
  };
}

/** Next search string after setting one filter (empty value removes it). */
export function withParam(params: URLSearchParams, key: string, value: string | null): string {
  const next = new URLSearchParams(params.toString());
  if (value) next.set(key, value);
  else next.delete(key);
  return next.toString();
}

/** Studio PR page when the PR is imported, else GitHub. */
export function prHref(run: CiRun): { href: string; external: boolean } | null {
  if (run.pr_number == null || !run.repo) return null;
  if (run.repo_id) return { href: `/repos/${run.repo_id}/pulls/${run.pr_number}`, external: false };
  return { href: githubPrUrl(run.repo, run.pr_number), external: true };
}

/** "850ms" / "42s" / "3m 05s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

export function verdictTone(v: CiVerdict): { color: string; bg: string } {
  if (v === "REQUEST_CHANGES") return { color: "var(--crit)", bg: "var(--crit-bg)" };
  if (v === "APPROVE") return { color: "var(--ok)", bg: "var(--ok-bg)" };
  return { color: "var(--info)", bg: "var(--info-bg)" };
}

/** Only http(s) links are rendered as links — job URLs come from GitHub's API. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
