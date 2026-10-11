/* hooks/multi-agent.ts — React Query hooks for Multi-Agent Review: the
   picker's candidates (estimates + latest summary), a PR's latest parent run
   view, and the repo's latest parent for the area landing. Starting a run goes
   through `useRunReview` ({ agentIds } or { all }). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  MultiAgentCandidate as MultiAgentCandidateSchema,
  MultiAgentRunRef as MultiAgentRunRefSchema,
  MultiAgentRunView as MultiAgentRunViewSchema,
} from "@devdigest/shared";
import { api } from "../api";
import { multiAgentKeys } from "./keys";

/** Poll interval while a parent run is in flight (NFR-4). */
const RUN_POLL_MS = 3000;

const CandidateList = z.array(MultiAgentCandidateSchema);
const NullableRunView = MultiAgentRunViewSchema.nullable();
const NullableRunRef = MultiAgentRunRefSchema.nullable();

/** Enabled agents for a PR, each with its time/cost estimate and latest summary. */
export function useMultiAgentCandidates(prId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: multiAgentKeys.candidates(prId),
    queryFn: () => api.get(`/pulls/${prId}/multi-agent/candidates`, CandidateList),
    enabled: !!prId && enabled,
  });
}

/** The PR's latest parent run (null when none). Polls while it is running. */
export function useLatestPrMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: multiAgentKeys.latestForPull(prId),
    queryFn: () => api.get(`/pulls/${prId}/multi-agent/latest`, NullableRunView),
    enabled: !!prId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? RUN_POLL_MS : false),
  });
}

/** Ref to the repo's latest parent run (null when none) — the area landing. */
export function useLatestRepoMultiAgentRun(repoId: string | null | undefined) {
  return useQuery({
    queryKey: multiAgentKeys.latestForRepo(repoId),
    queryFn: () => api.get(`/repos/${repoId}/multi-agent/latest`, NullableRunRef),
    enabled: !!repoId,
  });
}
