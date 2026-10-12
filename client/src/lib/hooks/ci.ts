/* hooks/ci.ts — React Query hooks for Export to CI (preview, export, update)
   and CI Runs (list, sync from GitHub Actions). */
"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CiAgentOverview as CiAgentOverviewSchema,
  CiExport as CiExportSchema,
  CiPreview as CiPreviewSchema,
  CiRun as CiRunSchema,
  CiRunnerResponse as CiRunnerResponseSchema,
  CiSyncResult as CiSyncResultSchema,
  CiUpdateResponse as CiUpdateResponseSchema,
} from "@devdigest/shared";
import type {
  CiAgentOverview,
  CiExport,
  CiExportInputBody,
  CiPreview,
  CiPreviewInputBody,
  CiRunsQueryInput,
} from "@devdigest/shared";
import { api } from "../api";
import { ciKeys } from "./keys";

/** Background sync cadence while a CI view is open and the tab is visible. */
const CI_AUTO_SYNC_MS = 120_000;

/**
 * `api` types its schema as `ZodType<T>` (input = output). CiFile's
 * `editable` has a `.default()`, so its input type is wider than its output —
 * view such schemas by their output type. Runtime validation is unchanged.
 */
function byOutput<S extends z.ZodTypeAny>(schema: S): z.ZodType<z.output<S>> {
  return schema as unknown as z.ZodType<z.output<S>>;
}

const CiPreviewOut = byOutput(CiPreviewSchema);
const CiExportOut = byOutput(CiExportSchema);
const CiRunList = z.array(CiRunSchema);

/** The generated bundle for the wizard's current choices (a mutation: it
 *  depends on wizard state, not on a cacheable key). */
export function useCiPreview(agentId: string) {
  return useMutation({
    mutationFn: (input: CiPreviewInputBody) =>
      api.post<CiPreview>(`/agents/${agentId}/ci/preview`, input, CiPreviewOut),
  });
}

export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input, CiExportOut),
    onSuccess: () => qc.invalidateQueries({ queryKey: ciKeys.agent(agentId) }),
  });
}

export function useUpdateCiConfig(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/ci/update`, undefined, CiUpdateResponseSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: ciKeys.agent(agentId) }),
  });
}

/** The agent's CI tab: installations, last runs, Fail CI on. */
export function useAgentCi(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciKeys.agent(agentId),
    queryFn: () => api.get<CiAgentOverview>(`/agents/${agentId}/ci`, CiAgentOverviewSchema),
    enabled: !!agentId,
  });
}

/** The runner bundle, fetched only for the zip download (`refetch()`). */
export function useCiRunner(agentId: string) {
  return useQuery({
    queryKey: ciKeys.runner(agentId),
    queryFn: () => api.get(`/agents/${agentId}/ci/runner`, CiRunnerResponseSchema),
    enabled: false,
    retry: false,
  });
}

export function useCiRuns(query: CiRunsQueryInput) {
  return useQuery({
    queryKey: ciKeys.runs(query),
    queryFn: () => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v != null && v !== "") sp.set(k, String(v));
      const qs = sp.toString();
      return api.get(`/ci/runs${qs ? `?${qs}` : ""}`, CiRunList);
    },
  });
}

/** Pull finished GitHub Actions runs back into the studio. */
export function useCiSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/ci/sync", {}, CiSyncResultSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: ciKeys.root() }),
  });
}

/** Sync once on mount, then every 2 minutes while the page is visible. */
export function useCiAutoSync(enabled: boolean) {
  const { mutate } = useCiSync();
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") mutate();
    };
    tick();
    const id = window.setInterval(tick, CI_AUTO_SYNC_MS);
    return () => window.clearInterval(id);
  }, [enabled, mutate]);
}
