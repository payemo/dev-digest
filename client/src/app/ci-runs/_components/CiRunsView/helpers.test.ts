import { describe, it, expect } from "vitest";
import { runStatusOf } from "@/lib/ci-status";
import { lastRunView, timeAgo } from "@/app/agents/[id]/_components/AgentEditor/_components/CiTab/helpers";
import { makeInstallation, makeRun } from "@/test/ci-fixtures";
import { formatDuration, prHref, queryFromParams, safeHttpUrl, withParam } from "./helpers";

/* Pure CI-view helpers. Breakage covered: a hostile job URL becoming a link,
   an invalid URL param reaching the API, an unknown stored status rendering,
   and an unverified last run reading as success. */

describe("CI view helpers", () => {
  it("safeHttpUrl only lets http(s) through", () => {
    expect(safeHttpUrl("https://github.com/a/b/actions/runs/1")).toBe("https://github.com/a/b/actions/runs/1");
    expect(safeHttpUrl("http://ghe.local/x")).toBe("http://ghe.local/x");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.com", "not a url", "", null, undefined]) {
      expect(safeHttpUrl(bad), String(bad)).toBeNull();
    }
  });

  it("queryFromParams falls back on invalid values; withParam sets and removes", () => {
    expect(queryFromParams(new URLSearchParams("days=0&status=bogus&agent_id=&repo=acme/x"))).toEqual({
      days: 7,
      agent_id: undefined,
      repo: "acme/x",
      status: undefined,
    });
    expect(queryFromParams(new URLSearchParams("days=90&status=no_findings"))).toMatchObject({ days: 90, status: "no_findings" });
    expect(withParam(new URLSearchParams("days=7&repo=a"), "repo", null)).toBe("days=7");
    expect(withParam(new URLSearchParams("days=7"), "status", "failed")).toBe("days=7&status=failed");
  });

  it("prHref prefers the studio PR page, else GitHub, else nothing", () => {
    expect(prHref(makeRun({ repo_id: "r1" }))).toEqual({ href: "/repos/r1/pulls/482", external: false });
    expect(prHref(makeRun({ repo_id: null }))).toEqual({
      href: "https://github.com/acme/payments-api/pull/482",
      external: true,
    });
    expect(prHref(makeRun({ pr_number: null }))).toBeNull();
  });

  it("formatDuration", () => {
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(185_000)).toBe("3m 05s");
    expect(formatDuration(null)).toBe("—");
  });

  it("runStatusOf narrows unknown statuses to null", () => {
    expect(runStatusOf("no_findings")).toBe("no_findings");
    expect(runStatusOf("hacked")).toBeNull();
    expect(runStatusOf(null)).toBeNull();
  });

  it("lastRunView never shows an unverified run as its status; timeAgo", () => {
    expect(lastRunView(makeInstallation({ last_run: null }))).toEqual({ kind: "none" });
    expect(
      lastRunView(makeInstallation({ last_run: { status: "succeeded", ran_at: "t", verification: "unverified" } })),
    ).toEqual({ kind: "unverified", ranAt: "t" });
    expect(
      lastRunView(makeInstallation({ last_run: { status: "failed", ran_at: "t", verification: "verified" } })),
    ).toEqual({ kind: "status", status: "failed", ranAt: "t" });

    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(timeAgo("2026-10-11T11:56:00Z", now)).toBe("4m ago");
    expect(timeAgo("2026-10-11T10:00:00Z", now)).toBe("2h ago");
    expect(timeAgo("2026-10-08T12:00:00Z", now)).toBe("3d ago");
    expect(timeAgo("garbage", now)).toBe("—");
    expect(timeAgo(null, now)).toBe("—");
  });
});
