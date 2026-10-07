/* hooks/eval.ts — React Query hooks for the L06 eval pipeline: cases (seeded
   from a finding or hand-made), single-case and full runs, the Evals tab, the
   Eval Dashboard, the per-agent detail page, Compare and Promote. */
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  EvalAgentDetail as EvalAgentDetailSchema,
  EvalAgentRun as EvalAgentRunSchema,
  EvalAgentRunDetail as EvalAgentRunDetailSchema,
  EvalCaseRecord as EvalCaseRecordSchema,
  EvalCaseResult as EvalCaseResultSchema,
  EvalCaseSeed as EvalCaseSeedSchema,
  EvalCompare as EvalCompareSchema,
  EvalPromoteResult as EvalPromoteResultSchema,
  EvalRunAllResult as EvalRunAllResultSchema,
  EvalStartResult as EvalStartResultSchema,
  EvalWorkspaceDashboard as EvalWorkspaceDashboardSchema,
} from "@devdigest/shared";
import type {
  EvalCaseFromFindingInput,
  EvalCaseInputBody,
} from "@devdigest/shared";
import { api } from "../api";
import { evalKeys } from "./keys";

/** Poll interval while a run is in flight (NFR-4: one PK row + an indexed select). */
const RUN_POLL_MS = 2000;

const EvalCaseRecordList = z.array(EvalCaseRecordSchema);
const EvalAgentRunList = z.array(EvalAgentRunSchema);

// ---- Cases ----------------------------------------------------------------

/** The seeded draft for a decided finding (or the case already made from it). */
export function useEvalCaseSeed(findingId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: evalKeys.seed(findingId),
    queryFn: () => api.get(`/findings/${findingId}/eval-case`, EvalCaseSeedSchema),
    enabled: !!findingId && enabled,
    retry: false,
  });
}

export function useCreateCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, overrides }: { findingId: string; overrides?: EvalCaseFromFindingInput }) =>
      api.post(`/findings/${findingId}/eval-case`, overrides ?? {}, EvalCaseRecordSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.root() }),
  });
}

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get(`/agents/${agentId}/eval/cases`, EvalCaseRecordList),
    enabled: !!agentId,
  });
}

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInputBody) =>
      api.post(`/agents/${agentId}/eval/cases`, input, EvalCaseRecordSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.root() }),
  });
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, input }: { caseId: string; input: EvalCaseInputBody }) =>
      api.put(`/eval/cases/${caseId}`, input, EvalCaseRecordSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.root() }),
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval/cases/${caseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.root() }),
  });
}

/** Single-case run (current version + skills) — updates the case's last result only. */
export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post(`/eval/cases/${caseId}/run`, undefined, EvalCaseResultSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.root() }),
  });
}

// ---- Runs -----------------------------------------------------------------

/** Start a full run (or re-attach to the agent's in-flight one). Returns at once. */
export function useStartEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      api.post(`/agents/${agentId}/eval/runs`, undefined, EvalStartResultSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.root() }),
  });
}

/** One run per agent with cases. */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/eval/runs/all", undefined, EvalRunAllResultSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.root() }),
  });
}

/** A run with its per-case results; polls while it is running. */
export function useEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.run(runId),
    queryFn: () => api.get(`/eval/runs/${runId}`, EvalAgentRunDetailSchema),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? RUN_POLL_MS : false),
  });
}

/**
 * Follow an in-flight run: keeps polling it after the caller stops seeing it
 * as in flight, and once it leaves `running` refreshes every eval view (tiles,
 * history, trend, dashboard) without a manual reload. Returns the run query,
 * whose `results` feed per-case progress.
 */
export function useEvalRunWatcher(runId: string | null | undefined) {
  const qc = useQueryClient();
  const [watched, setWatched] = useState<string | null>(null);
  useEffect(() => {
    if (runId) setWatched(runId);
  }, [runId]);
  const run = useEvalRun(watched);
  const status = run.data?.id === watched ? run.data?.status : undefined;
  useEffect(() => {
    if (watched && status && status !== "running") {
      setWatched(null);
      void qc.invalidateQueries({ queryKey: evalKeys.root() });
    }
  }, [watched, status, qc]);
  return run;
}

export function useEvalAgentRuns(agentId: string | null | undefined, days: number) {
  return useQuery({
    queryKey: evalKeys.runs(agentId, days),
    queryFn: () => api.get(`/agents/${agentId}/eval/runs?days=${days}`, EvalAgentRunList),
    enabled: !!agentId,
  });
}

/** Per-agent page data; polls while a run is in flight so progress advances. */
export function useEvalAgentDetail(agentId: string | null | undefined, days: number) {
  return useQuery({
    queryKey: evalKeys.detail(agentId, days),
    queryFn: () => api.get(`/agents/${agentId}/eval/detail?days=${days}`, EvalAgentDetailSchema),
    enabled: !!agentId,
    refetchInterval: (q) => (q.state.data?.in_flight ? RUN_POLL_MS : false),
  });
}

/** Workspace dashboard; polls while any agent has a run in flight. */
export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard(),
    queryFn: () => api.get("/eval/dashboard", EvalWorkspaceDashboardSchema),
    refetchInterval: (q) =>
      q.state.data?.agents.some((a) => a.in_flight) ? RUN_POLL_MS : false,
  });
}

/** Compare two runs (enabled only when both are chosen). */
export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () => api.get(`/eval/compare?a=${a}&b=${b}`, EvalCompareSchema),
    enabled: !!a && !!b,
  });
}

/** Promote the agent version a run was made with (a NEW version copying it). */
export function usePromoteVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, runId }: { agentId: string; runId: string }) =>
      api.post(`/agents/${agentId}/eval/promote`, { run_id: runId }, EvalPromoteResultSchema),
    onSuccess: (_data, { agentId }) => {
      void qc.invalidateQueries({ queryKey: ["agent", agentId] });
      void qc.invalidateQueries({ queryKey: ["agents"] });
      void qc.invalidateQueries({ queryKey: evalKeys.root() });
    },
  });
}
