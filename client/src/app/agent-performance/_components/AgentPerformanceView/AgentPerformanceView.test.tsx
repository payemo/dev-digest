import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mockApi } from "@/test/ci-fixtures";
import { makeAgentStats, makePerformance, renderStats } from "@/test/agent-performance-fixtures";

/* Agent Performance dashboard. `fetch` is stubbed at the network seam and the
   App Router's URL is a reactive stand-in, so a period change re-fetches like
   the real page. Breakage covered: loading/error states showing invented
   zeros (AC5), the empty workspace and a zero-run agent collapsing into one
   state (AC4), missing "estimate" provenance (AC7), a cost delta with the
   wrong sign/colour or a number invented against an empty period (AC8), a
   sparkline drawn from a single bucket, the View link losing the window
   (AC11), and any interaction issuing a non-GET or non-dashboard call (AC6). */

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), listeners: new Set<() => void>() }));
vi.mock("next/navigation", async () =>
  (await import("@/test/agent-performance-fixtures")).navModule(nav, "/agent-performance"),
);

import { AgentPerformanceView } from "./AgentPerformanceView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.replace.mockReset();
  nav.listeners.clear();
  nav.search = "";
});

const PERF = "GET /agent-performance";

/** The KPI card column holding `label` (label → MetricCard → column). */
const kpi = (label: string) => screen.getByText(label).closest("div")!.parentElement!.parentElement as HTMLElement;

describe("AgentPerformanceView", () => {
  it("shows skeletons with no digits while loading, and an error with no KPI numbers when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderStats(<AgentPerformanceView />);

    const loading = await screen.findByTestId("agent-performance-loading");
    expect(loading.textContent).not.toMatch(/\d/);
    expect(screen.queryByText("Total runs")).not.toBeInTheDocument();
    cleanup();
    vi.unstubAllGlobals();

    const calls = mockApi({ [PERF]: { status: 500, json: { error: { code: "boom", message: "boom" } } } });
    renderStats(<AgentPerformanceView />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Could not load agent performance.")).toBeInTheDocument();
    expect(screen.queryByText("Total runs")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("renders KPIs, estimate provenance, a red cost increase and a multi-day sparkline", async () => {
    mockApi({ [PERF]: { json: makePerformance() } });
    renderStats(<AgentPerformanceView />);

    await screen.findByText("Total runs");
    const runs = kpi("Total runs");
    expect(within(runs).getByText("12")).toBeInTheDocument();
    expect(within(runs).getByText("1 failed run not counted")).toBeInTheDocument();
    // 3 daily buckets → sparkline drawn (it has no accessible role; it is an <svg>)
    expect(runs.querySelector("svg")).not.toBeNull();

    const cost = kpi("Total cost");
    expect(within(cost).getByText("$0.050")).toBeInTheDocument();
    expect(within(cost).getByText("Estimated")).toBeInTheDocument();
    const up = within(cost).getByText("+$0.020 vs previous 30 days");
    expect(up).toHaveStyle({ color: "var(--crit)" });

    expect(within(kpi("Avg accept rate")).getByText("8 of 10 decisions")).toBeInTheDocument();
    expect(within(kpi("Most-active agent")).getByText("12 runs · 80% accept (10 decisions)")).toBeInTheDocument();

    expect(screen.getByText(/All costs are DevDigest estimates/)).toBeInTheDocument();
    expect(screen.getByText("Cost breakdown · Estimated")).toBeInTheDocument();
  });

  it("shows a cost decrease in green, and no amount at all when the previous period had no runs", async () => {
    mockApi({
      [PERF]: { json: makePerformance({ cost_delta_usd: -0.0204, runs_trend: [{ label: "2026-10-13", value: 12 }] }) },
    });
    renderStats(<AgentPerformanceView />);

    await screen.findByText("Total cost");
    const cost = kpi("Total cost");
    const down = within(cost).getByText("−$0.020 vs previous 30 days");
    expect(down).toHaveStyle({ color: "var(--ok)" });
    // A single daily bucket → no sparkline
    expect(kpi("Total runs").querySelector("svg")).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    mockApi({
      [PERF]: {
        json: makePerformance({
          cost_delta_usd: null,
          previous_totals: { runs: 0, total_cost_usd: null, decisions: 0, accept_rate: null },
        }),
      },
    });
    renderStats(<AgentPerformanceView />);
    await screen.findByText("Total cost");
    const none = within(kpi("Total cost")).getByText("No runs in the previous period to compare");
    expect(none.textContent).not.toMatch(/\$/);
    expect(within(kpi("Total cost")).queryByText(/vs previous/)).not.toBeInTheDocument();
  });

  it("tells an empty workspace apart from an agent that simply had no runs", async () => {
    mockApi({
      [PERF]: {
        json: makePerformance({
          totals: {
            runs: 0, failed_runs: 0, unpriced_runs: 0, deleted_agent_runs: 0, total_cost_usd: null,
            accepted: 0, dismissed: 0, decisions: 0, accept_rate: null,
          },
          most_active: null,
          cost_delta_usd: null,
          agents: [makeAgentStats({ runs: 0, failed_runs: 0, decisions: 0, accept_rate: null, low_sample: true })],
          cost_by_agent: [],
          cost_by_model: [],
        }),
      },
    });
    renderStats(<AgentPerformanceView />);
    expect(await screen.findByText("No agent runs in this period")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Total runs")).not.toBeInTheDocument();
    cleanup();
    vi.unstubAllGlobals();

    mockApi({
      [PERF]: {
        json: makePerformance({
          agents: [
            makeAgentStats(),
            makeAgentStats({
              agent_id: "ag-idle", agent_name: "Idle Reviewer", runs: 0, failed_runs: 0, decisions: 0,
              accepted: 0, dismissed: 0, pending: 0, accept_rate: null, low_sample: true, last_run_at: null,
              avg_cost_usd: null, avg_latency_ms: null, total_cost_usd: null, accept_trend: null, accept_rate_delta_pp: null,
            }),
          ],
        }),
      },
    });
    renderStats(<AgentPerformanceView />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("No runs in this period")).toBeInTheDocument();
    expect(screen.queryByText("No agent runs in this period")).not.toBeInTheDocument();
  });

  it("links each row to the agent's Stats tab on the URL's custom window — the same window it fetched", async () => {
    nav.search = "period=custom&from=2026-10-01&to=2026-10-07";
    const calls = mockApi({ [PERF]: { json: makePerformance() } });
    renderStats(<AgentPerformanceView />);

    const view = await screen.findByRole("link", { name: "View Security Reviewer stats" });
    expect(view).toHaveAttribute("href", "/agents/ag1?tab=stats&period=custom&from=2026-10-01&to=2026-10-07");

    const sent = new URLSearchParams(calls[0]!.path.split("?")[1]);
    expect(sent.get("from")).toBe(new Date(2026, 9, 1).toISOString());
    expect(sent.get("to")).toBe(new Date(2026, 9, 8).toISOString());
  });

  it("only ever issues GET /agent-performance across load, retry, sorting, expansion and a period change", async () => {
    let fail = true;
    const calls = mockApi({
      [PERF]: () =>
        fail ? { status: 500, json: { error: { code: "boom", message: "boom" } } } : { json: makePerformance() },
    });
    renderStats(<AgentPerformanceView />);

    fail = true;
    const alert = await screen.findByRole("alert");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("table")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sort by Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort by Avg cost" }));
    const toggle = screen.getByRole("button", { name: "Show details for Security Reviewer" });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(calls).toHaveLength(2); // initial + retry; local interactions fetch nothing

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1d" } });
    expect(nav.replace).toHaveBeenCalledWith("/agent-performance?period=1d");
    await waitFor(() => expect(calls).toHaveLength(3));

    const day = new URLSearchParams(calls[2]!.path.split("?")[1]);
    expect(Date.parse(day.get("to")!) - Date.parse(day.get("from")!)).toBe(24 * 60 * 60 * 1000);
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(call.path.startsWith("/agent-performance?")).toBe(true);
    }
  });
});
