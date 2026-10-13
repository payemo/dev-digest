import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AGENT, mockApi } from "@/test/ci-fixtures";
import { makeAgentStats, renderStats } from "@/test/agent-performance-fixtures";
import { AgentTable } from "@/app/agent-performance/_components/AgentPerformanceView/_components/AgentTable";

/* Agent editor Stats tab. `fetch` is stubbed at the network seam and the App
   Router's URL is a reactive stand-in. Breakage covered: the tab showing
   different runs / cost / duration / accept figures than the dashboard row
   for the same AgentStats (AC1 UI), opening on a different window than the
   dashboard's View link carried (AC11), loading / error / no-run states
   rendering invented zeros (AC4, AC5), and any non-GET or foreign call (AC6). */

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), listeners: new Set<() => void>() }));
vi.mock("next/navigation", async () =>
  (await import("@/test/agent-performance-fixtures")).navModule(nav, "/agents/ag1"),
);

import { StatsTab } from "./StatsTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.replace.mockReset();
  nav.listeners.clear();
  nav.search = "";
});

const STATS = "GET /agents/ag1/stats";

/** The tile holding `label` (label → MetricCard header → MetricCard). */
const tile = (label: string) => screen.getByText(label).parentElement!.parentElement as HTMLElement;

describe("StatsTab", () => {
  it("shows the same runs, avg cost, avg duration, accept % and decisions as the dashboard row for the same stats", async () => {
    const stats = makeAgentStats();

    // The dashboard row for this AgentStats
    renderStats(<AgentTable rows={[stats]} minDecisions={10} periodQuery="period=30d" />);
    const row = within(screen.getByRole("button", { name: "Show details for Security Reviewer" }).closest("tr")!);
    for (const text of ["12", "$0.0042", "8.2s", "80%", "n=10"]) expect(row.getByText(text)).toBeInTheDocument();
    cleanup();

    // The Stats tab for the same AgentStats
    mockApi({ [STATS]: { json: stats } });
    renderStats(<StatsTab agent={AGENT} />);
    await screen.findByText("Runs");
    expect(within(tile("Runs")).getByText("12")).toBeInTheDocument();
    expect(within(tile("Avg cost")).getByText("$0.0042")).toBeInTheDocument();
    expect(within(tile("Avg cost")).getByText("Estimated")).toBeInTheDocument();
    expect(within(tile("Avg duration")).getByText("8.2s")).toBeInTheDocument();
    expect(within(tile("Accept rate")).getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("8 of 10 decisions")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "+20 pts vs previous period" })).toBeInTheDocument();
    expect(screen.getByText(/All costs are DevDigest estimates/)).toBeInTheDocument();
  });

  it("fetches the same window the dashboard's View link carried, keeping the tab param on period change", async () => {
    nav.search = "tab=stats&period=custom&from=2026-10-01&to=2026-10-07";
    const calls = mockApi({ [STATS]: { json: makeAgentStats() } });
    renderStats(<StatsTab agent={AGENT} />);

    await screen.findByText("Runs");
    const sent = new URLSearchParams(calls[0]!.path.split("?")[1]);
    expect(sent.get("from")).toBe(new Date(2026, 9, 1).toISOString());
    expect(sent.get("to")).toBe(new Date(2026, 9, 8).toISOString());

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "30d" } });
    expect(nav.replace).toHaveBeenCalledWith("/agents/ag1?tab=stats&period=30d");
    await waitFor(() => expect(calls).toHaveLength(2));
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(call.path.startsWith("/agents/ag1/stats?")).toBe(true);
    }
  });

  it("never shows invented zeros while loading, on error, or for an agent with no runs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderStats(<StatsTab agent={AGENT} />);
    const loading = await screen.findByTestId("agent-stats-loading");
    expect(loading.textContent).not.toMatch(/\d/);
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
    cleanup();
    vi.unstubAllGlobals();

    const failing = mockApi({ [STATS]: { status: 500, json: { error: { code: "boom", message: "boom" } } } });
    renderStats(<StatsTab agent={AGENT} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Could not load this agent's stats.")).toBeInTheDocument();
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(failing).toHaveLength(2));
    expect(failing.every((c) => c.method === "GET")).toBe(true);
    cleanup();
    vi.unstubAllGlobals();

    mockApi({
      [STATS]: {
        json: makeAgentStats({
          runs: 0, failed_runs: 0, decisions: 0, accepted: 0, dismissed: 0, pending: 0, accept_rate: null,
          avg_cost_usd: null, avg_latency_ms: null, total_cost_usd: null, last_run_at: null, low_sample: true,
          accept_trend: null, accept_rate_delta_pp: null,
        }),
      },
    });
    renderStats(<StatsTab agent={AGENT} />);
    expect(await screen.findByText("No runs in this period")).toBeInTheDocument();
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});
