/* Shared fixtures for the Agent Performance dashboard and the agent Stats tab
   tests: contract-valid DTOs, a mutable App Router stand-in (so a period
   change re-renders the view like a real URL change would) and a render
   helper with the real providers. `fetch` is stubbed via `mockApi` from
   ci-fixtures — the one network seam every `src/lib/hooks/*` call goes through. */
import React, { useSyncExternalStore } from "react";
import { vi } from "vitest";
import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentPerformance, AgentStats } from "@devdigest/shared";
import agentPerformanceMessages from "../../messages/en/agentPerformance.json";
import agentsMessages from "../../messages/en/agents.json";

export const WINDOW = { from: "2026-09-13T12:00:00.000Z", to: "2026-10-13T12:00:00.000Z" };
export const PREVIOUS_WINDOW = { from: "2026-08-14T12:00:00.000Z", to: "2026-09-13T12:00:00.000Z" };

export function makeAgentStats(o: Partial<AgentStats> = {}): AgentStats {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    enabled: true,
    window: WINDOW,
    previous_window: PREVIOUS_WINDOW,
    runs: 12,
    failed_runs: 1,
    unpriced_runs: 0,
    findings_total: 13,
    accepted: 8,
    dismissed: 2,
    pending: 3,
    decisions: 10,
    accept_rate: 0.8,
    dismiss_rate: 0.2,
    low_sample: false,
    avg_findings_per_run: 13 / 12,
    total_cost_usd: 0.0504,
    avg_cost_usd: 0.0042,
    avg_latency_ms: 8200,
    last_run_at: "2026-10-13T10:00:00.000Z",
    findings_by_severity: { CRITICAL: 2, WARNING: 5, SUGGESTION: 6 },
    trend: [
      { label: "2026-10-11", value: 4 },
      { label: "2026-10-12", value: 3 },
      { label: "2026-10-13", value: 5 },
    ],
    previous: { runs: 9, decisions: 10, accept_rate: 0.6, low_sample: false, total_cost_usd: 0.03 },
    accept_trend: "up",
    accept_rate_delta_pp: 20,
    cost_basis: "estimate",
    ...o,
  };
}

export function makePerformance(o: Partial<AgentPerformance> = {}): AgentPerformance {
  const agents = o.agents ?? [makeAgentStats()];
  return {
    window: WINDOW,
    previous_window: PREVIOUS_WINDOW,
    cost_basis: "estimate",
    min_decisions_for_ranking: 10,
    totals: {
      runs: 12,
      failed_runs: 1,
      unpriced_runs: 0,
      deleted_agent_runs: 0,
      total_cost_usd: 0.0504,
      accepted: 8,
      dismissed: 2,
      decisions: 10,
      accept_rate: 0.8,
    },
    previous_totals: { runs: 9, total_cost_usd: 0.03, decisions: 10, accept_rate: 0.6 },
    cost_delta_usd: 0.0204,
    most_active: { agent_id: "ag1", agent_name: "Security Reviewer", runs: 12, accept_rate: 0.8, decisions: 10 },
    agents,
    cost_by_agent: [{ key: "ag1", label: "Security Reviewer", cost_usd: 0.0504, runs: 12 }],
    cost_by_model: [{ key: "gpt-4.1", label: "gpt-4.1", cost_usd: 0.0504, runs: 12 }],
    runs_trend: [
      { label: "2026-10-11", value: 4 },
      { label: "2026-10-12", value: 3 },
      { label: "2026-10-13", value: 5 },
    ],
    ...o,
  };
}

/**
 * A stand-in for the App Router's URL: `replace` updates the search string and
 * re-renders every `useSearchParams` reader, as a real navigation would.
 * Wire it with `vi.mock("next/navigation", () => navModule(nav, "/path"))`.
 */
export interface FakeNav {
  search: string;
  replace: ReturnType<typeof vi.fn>;
  listeners: Set<() => void>;
}

export function createNav(): FakeNav {
  return { search: "", replace: vi.fn(), listeners: new Set() };
}

export function navModule(nav: FakeNav, pathname: string) {
  const subscribe = (l: () => void) => {
    nav.listeners.add(l);
    return () => nav.listeners.delete(l);
  };
  return {
    useRouter: () => ({
      replace: (url: string) => {
        nav.replace(url);
        nav.search = url.split("?")[1] ?? "";
        nav.listeners.forEach((l) => l());
      },
      push: vi.fn(),
    }),
    usePathname: () => pathname,
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => nav.search, () => nav.search)),
  };
}

/** Real providers: React Query (no retries) and next-intl with both namespaces. */
export function renderStats(ui: React.ReactElement): RenderResult {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ agentPerformance: agentPerformanceMessages, agents: agentsMessages }}
        timeZone="UTC"
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
