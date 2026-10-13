import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { makeAgentStats, renderStats } from "@/test/agent-performance-fixtures";
import { mockApi } from "@/test/ci-fixtures";
import { AgentTable } from "./AgentTable";

/* Per-agent table. Breakage covered: a low-sample agent sorting above agents
   with real evidence (R10), expansion hiding the decision breakdown or
   fetching to get it (AC6), the View link losing the period so the Stats tab
   opens on a different window (AC11), and a zero-run agent showing invented
   zeros instead of dashes (AC4). */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROWS = [
  makeAgentStats({ agent_id: "ag-low", agent_name: "Low Sample", runs: 2, accept_rate: 1, accepted: 1, dismissed: 0, decisions: 1, low_sample: true, accept_trend: null, accept_rate_delta_pp: null }),
  makeAgentStats({ agent_id: "ag-mid", agent_name: "Mid Reviewer", runs: 30, accept_rate: 0.5, decisions: 12 }),
  makeAgentStats({ agent_id: "ag1", agent_name: "Security Reviewer", runs: 12 }),
  makeAgentStats({
    agent_id: "ag-idle",
    agent_name: "Idle Reviewer",
    runs: 0,
    failed_runs: 0,
    accept_rate: null,
    accepted: 0,
    dismissed: 0,
    pending: 0,
    decisions: 0,
    low_sample: true,
    avg_cost_usd: null,
    avg_latency_ms: null,
    total_cost_usd: null,
    last_run_at: null,
    accept_trend: null,
    accept_rate_delta_pp: null,
  }),
];

const PERIOD_QUERY = "period=custom&from=2026-10-01&to=2026-10-07";

const rowOrder = () =>
  screen
    .getAllByRole("button", { name: /^Show details for / })
    .map((b) => b.getAttribute("aria-label")!.replace("Show details for ", ""));

const rowOf = (name: string) =>
  screen.getByRole("button", { name: `Show details for ${name}` }).closest("tr") as HTMLElement;

describe("AgentTable", () => {
  it("sorts accept rate with low-sample and zero-run agents last in both directions, without fetching", () => {
    const calls = mockApi({});
    renderStats(<AgentTable rows={ROWS} minDecisions={10} periodQuery={PERIOD_QUERY} />);

    // Default: runs, descending
    expect(rowOrder()).toEqual(["Mid Reviewer", "Security Reviewer", "Low Sample", "Idle Reviewer"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Accept" }));
    expect(rowOrder()).toEqual(["Security Reviewer", "Mid Reviewer", "Low Sample", "Idle Reviewer"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Accept" }));
    expect(rowOrder()).toEqual(["Mid Reviewer", "Security Reviewer", "Low Sample", "Idle Reviewer"]);

    expect(within(rowOf("Low Sample")).getByText("Low sample")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("expands a row to its decision breakdown from loaded data and collapses it again, without fetching", () => {
    const calls = mockApi({});
    renderStats(<AgentTable rows={ROWS} minDecisions={10} periodQuery={PERIOD_QUERY} />);

    const toggle = screen.getByRole("button", { name: "Show details for Security Reviewer" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Each <dt> term is followed by its <dd> value
    const value = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
    expect(value("Accepted")).toBe("8");
    expect(value("Dismissed")).toBe("2");
    expect(value("Pending")).toBe("3");
    expect(value("Previous period")).toBe("60% accept (10 decisions)");

    fireEvent.click(toggle);
    expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("links View to the agent's Stats tab on the same period, and shows dashes for an agent with no runs", () => {
    renderStats(<AgentTable rows={ROWS} minDecisions={10} periodQuery={PERIOD_QUERY} />);

    expect(screen.getByRole("link", { name: "View Security Reviewer stats" })).toHaveAttribute(
      "href",
      `/agents/ag1?tab=stats&${PERIOD_QUERY}`,
    );

    const idle = within(rowOf("Idle Reviewer"));
    expect(idle.getByText("No runs in this period")).toBeInTheDocument();
    expect(idle.getAllByText("—").length).toBeGreaterThanOrEqual(5);
    expect(idle.queryByText("0")).not.toBeInTheDocument();
    expect(idle.queryByText(/%/)).not.toBeInTheDocument();
  });
});
