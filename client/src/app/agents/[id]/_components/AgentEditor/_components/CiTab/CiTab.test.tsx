import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import {
  AGENT,
  REPOS,
  SYNC_OK,
  makeInstallation,
  makeOverview,
  makeRun,
  mockApi,
  renderCi,
} from "@/test/ci-fixtures";
import { CiTab } from "./CiTab";

/* The agent's CI tab: where the agent is installed, the Fail CI on gate,
   Update CI config and the Add to CI entry point. `fetch` is stubbed at the
   network seam; hooks, React Query and providers are real. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = {
  "GET /repos": { json: REPOS },
  "POST /ci/sync": SYNC_OK,
};

describe("CiTab", () => {
  it("lists installations with their state and recommits PR installs via Update CI config", async () => {
    const calls = mockApi({
      ...base,
      "GET /agents/ag1/ci": {
        json: makeOverview({
          active_repos: 2,
          installations: [
            makeInstallation({
              outdated: true,
              last_run: { status: "succeeded", ran_at: "2026-10-10T00:00:00Z", verification: "unverified" },
            }),
            makeInstallation({ id: "i2", repo: "acme/web", branch: null, pr_url: null }),
          ],
          recent_runs: [makeRun({ status: "failed", verification: "unverified" })],
        }),
      },
      "POST /agents/ag1/ci/update": { json: { installations: [makeInstallation()] } },
    });
    renderCi(<CiTab agent={AGENT} />);

    expect(await screen.findByText("Active in 2 repos")).toBeInTheDocument();
    // PR install: version meta, update badge, PR link; an unverified last run never reads as success.
    expect(screen.getByText("workflow v1 · agent v3 · runner 2")).toBeInTheDocument();
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("Unverified run")).toBeInTheDocument();
    expect(screen.queryByText("succeeded")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR" })).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/12");
    // Zip install.
    expect(screen.getByText("installed manually (zip)")).toBeInTheDocument();
    expect(screen.getByText("no runs yet")).toBeInTheDocument();
    // History links to the CI Runs page filtered to this agent.
    // History row: its own status plus the unverified badge.
    expect(screen.getByText("acme/payments-api #482")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("unverified")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all CI runs" })).toHaveAttribute("href", "/ci-runs?agent_id=ag1");

    // Opening the tab syncs runs from GitHub Actions.
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/ci/sync")).toBe(true));

    const update = screen.getByRole("button", { name: /Update CI config/ });
    expect(update).toBeEnabled();
    fireEvent.click(update);
    expect(await screen.findByText("Updated 1 installation")).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/agents/ag1/ci/update")).toHaveLength(1);
  });

  it("Fail CI on: switching the gate saves the agent; 'any' shows as a read-only selected pill", async () => {
    const calls = mockApi({
      ...base,
      "GET /agents/ag1/ci": { json: makeOverview() },
      "PUT /agents/ag1": (body) => ({ json: { ...AGENT, ...(body as object) } }),
    });
    renderCi(<CiTab agent={AGENT} />);
    const group = await screen.findByRole("radiogroup", { name: "Fail CI on" });
    expect(within(group).getByRole("radio", { name: "Critical" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(group).getByRole("radio", { name: "Critical" })); // already selected: no save
    fireEvent.click(within(group).getByRole("radio", { name: "Warning +" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ ci_fail_on: "warning" });

    cleanup();
    mockApi({ ...base, "GET /agents/ag1/ci": { json: makeOverview({ ci_fail_on: "any" }) } });
    renderCi(<CiTab agent={AGENT} />);
    const anyGroup = await screen.findByRole("radiogroup", { name: "Fail CI on" });
    const anyPill = await within(anyGroup).findByRole("radio", { name: "Any finding (set in Config)" });
    expect(anyPill).toHaveAttribute("aria-checked", "true");
    expect(anyPill).toHaveAttribute("aria-disabled", "true");
    for (const name of ["Critical", "Warning +", "Never"]) {
      expect(within(anyGroup).getByRole("radio", { name })).toHaveAttribute("aria-checked", "false");
    }
  });

  it("Update CI config is disabled without a PR installation; Add to CI opens the wizard", async () => {
    mockApi({
      ...base,
      "GET /agents/ag1/ci": {
        json: makeOverview({ installations: [makeInstallation({ branch: null, pr_url: null })] }),
      },
    });
    renderCi(<CiTab agent={AGENT} />);
    expect(await screen.findByText("installed manually (zip)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update CI config/ })).toBeDisabled();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add to CI/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Export to CI")).toBeInTheDocument();
    expect(within(dialog).getByText("Run Security Reviewer automatically on pull requests")).toBeInTheDocument();
  });
});
