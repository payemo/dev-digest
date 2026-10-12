import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { REPOS, SYNC_OK, makeRun, mockApi, renderCi } from "@/test/ci-fixtures";

/* CI Runs page. `fetch` is stubbed at the network seam; the App Router is
   mocked (outside world) so the URL-mirrored filters can be observed. Breakage
   covered: a column showing the wrong value (or a self-reported count), an
   unverified run looking trustworthy, a non-http job link becoming clickable,
   filters not reaching the URL / the API, and refresh not syncing. */

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/ci-runs",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { CiRunsView } from "./CiRunsView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.replace.mockReset();
  nav.search = "";
});

const AGENTS = [
  { id: "ag1", name: "Security Reviewer" },
  { id: "ag2", name: "Perf Reviewer" },
];

const RUNS = [
  makeRun({
    id: "c1",
    findings_count: 1,
    reported_findings_count: 3,
    verification: "unverified",
    repo_id: "r1",
  }),
  makeRun({
    id: "c2",
    pr_number: 9,
    repo: "acme/web",
    status: "failed",
    verdict: null,
    findings_count: null,
    reported_findings_count: null,
    cost_usd: null,
    duration_ms: null,
    job_url: "javascript:alert(1)",
    github_url: null,
  }),
];

const rowOf = (repo: string) => {
  const row = screen.getAllByRole("row").find((r) => within(r).queryByText(repo, { selector: '[role="cell"]' }));
  if (!row) throw new Error(`no row for ${repo}`);
  return row;
};

describe("CiRunsView", () => {
  it("renders each run's verdict, re-grounded findings, cost, duration, status and a safe job link", async () => {
    const calls = mockApi({
      "GET /repos": { json: REPOS },
      "GET /agents": { json: AGENTS },
      "GET /ci/runs": { json: RUNS },
      "POST /ci/sync": SYNC_OK,
    });
    renderCi(<CiRunsView />);

    const first = within(await waitFor(() => rowOf("acme/payments-api")));
    expect(first.getByText("Request changes")).toBeInTheDocument();
    // Studio count first, CI's self-reported count in brackets when they differ.
    expect(first.getByText("(3)")).toBeInTheDocument();
    expect(first.getByText("$0.012")).toBeInTheDocument();
    expect(first.getByText("1m 05s")).toBeInTheDocument();
    expect(first.getByText("Succeeded")).toBeInTheDocument();
    expect(first.getByText("unverified")).toBeInTheDocument();
    expect(first.getByRole("link", { name: "#482" })).toHaveAttribute("href", "/repos/r1/pulls/482");
    expect(first.getByRole("link", { name: "Security Reviewer" })).toHaveAttribute("href", "/agents/ag1?tab=ci");
    expect(first.getByRole("link", { name: /View job/ })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/actions/runs/1",
    );

    const second = within(rowOf("acme/web"));
    expect(second.getByText("Failed")).toBeInTheDocument();
    expect(second.getAllByText("—").length).toBeGreaterThanOrEqual(4); // verdict, findings, cost, duration
    expect(second.queryByText("unverified")).not.toBeInTheDocument();
    expect(second.queryByRole("link", { name: /View job/ })).not.toBeInTheDocument();
    expect(second.getByRole("link", { name: "#9" })).toHaveAttribute("href", "https://github.com/acme/web/pull/9");

    // Refresh syncs now and reports the outcome.
    await waitFor(() => expect(calls.filter((c) => c.path === "/ci/sync")).toHaveLength(1)); // auto-sync on open
    mockApi({
      "GET /repos": { json: REPOS },
      "GET /agents": { json: AGENTS },
      "GET /ci/runs": { json: RUNS },
      "POST /ci/sync": { json: { ingested: 2, failed_runs: 0, skipped: 0, rejected: [{ installation_id: "i", github_run_id: 1, reason: "fork_run" }], errors: [] } },
    });
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("Synced: 2 new, 1 rejected")).toBeInTheDocument();
  });

  it("reads filters from the URL into the query and writes changes back to the URL", async () => {
    nav.search = "days=30&status=failed&agent_id=ag2";
    const calls = mockApi({
      "GET /repos": { json: REPOS },
      "GET /agents": { json: AGENTS },
      "GET /ci/runs": { json: [] },
      "POST /ci/sync": SYNC_OK,
    });
    renderCi(<CiRunsView />);
    expect(await screen.findByText("No CI runs yet")).toBeInTheDocument();
    const runsCall = calls.find((c) => c.path.startsWith("/ci/runs"))!;
    expect(new URLSearchParams(runsCall.path.split("?")[1])).toEqual(
      new URLSearchParams("days=30&agent_id=ag2&status=failed"),
    );

    const [days, agent, repo, status] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(days!.value).toBe("30");
    expect(agent!.value).toBe("ag2");
    expect(status!.value).toBe("failed");

    await waitFor(() => expect(within(repo!).getByRole("option", { name: "acme/web" })).toBeInTheDocument());
    fireEvent.change(repo!, { target: { value: "acme/web" } });
    expect(nav.replace).toHaveBeenLastCalledWith("/ci-runs?days=30&status=failed&agent_id=ag2&repo=acme%2Fweb");
    fireEvent.change(status!, { target: { value: "" } });
    expect(nav.replace).toHaveBeenLastCalledWith("/ci-runs?days=30&agent_id=ag2");
  });

  it("ignores an out-of-range window and shows an error state when runs cannot load", async () => {
    nav.search = "days=365&status=bogus";
    const calls = mockApi({
      "GET /repos": { json: REPOS },
      "GET /agents": { json: AGENTS },
      "GET /ci/runs": { status: 500, json: { error: { code: "internal", message: "db down" } } },
      "POST /ci/sync": SYNC_OK,
    });
    renderCi(<CiRunsView />);
    expect(await screen.findByText("Couldn't load CI runs.")).toBeInTheDocument();
    expect(calls.find((c) => c.path.startsWith("/ci/runs"))!.path).toBe("/ci/runs?days=7");
  });
});
