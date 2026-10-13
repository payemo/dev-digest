/* hooks/agent-performance.ts — read-only React Query hooks for the Agent
   Performance dashboard and the agent editor's Stats tab. Both endpoints
   aggregate stored runs and findings only; nothing here triggers a review or
   a model call, so there are deliberately no mutations. */
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentPerformance, AgentStats, StatsWindow } from "@devdigest/shared";
import { agentPerformanceKeys } from "./keys";

function windowQuery(window: StatsWindow): string {
  return `from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`;
}

/** Every agent's stats + totals for the window. Disabled until a window is set. */
export function useAgentPerformance(window: StatsWindow | null) {
  return useQuery({
    queryKey: agentPerformanceKeys.window(window?.from ?? "", window?.to ?? ""),
    queryFn: () => api.get<AgentPerformance>(`/agent-performance?${windowQuery(window!)}`),
    enabled: window !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** One agent's stats for the window — the same numbers as its dashboard row. */
export function useAgentStats(id: string | null | undefined, window: StatsWindow | null) {
  return useQuery({
    queryKey: agentPerformanceKeys.agentStats(id, window?.from ?? "", window?.to ?? ""),
    queryFn: () =>
      api.get<AgentStats>(`/agents/${encodeURIComponent(id!)}/stats?${windowQuery(window!)}`),
    enabled: !!id && window !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
