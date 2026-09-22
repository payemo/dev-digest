/* hooks/conventions.ts — React Query hooks for the Conventions Extractor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillCreate,
  ConventionSkillDraft,
  ConventionUpdate,
  Skill,
} from "@devdigest/shared";
import { conventionKeys, skillKeys } from "./keys";

/** Persisted candidates for a repo — survives reload; `Run Scan`/`Re-scan` refresh it via the extract mutation. */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: conventionKeys.forRepo(repoId),
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * Run a scan. A MUTATION, not a query — it costs a model call — and seeds the
 * list cache from its own response so the page doesn't need a second round
 * trip to show results.
 */
export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data, repoId) => {
      qc.setQueryData(conventionKeys.forRepo(repoId), data.candidates);
    },
  });
}

export interface UpdateConventionInput {
  repoId: string;
  id: string;
  patch: ConventionUpdate;
}

/** Accept / Reject / inline Edit — all three are the same PATCH, persistent immediately. */
export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (data, { repoId }) => {
      qc.setQueryData<ConventionCandidate[]>(conventionKeys.forRepo(repoId), (prev) =>
        prev?.map((c) => (c.id === data.id ? data : c)),
      );
    },
  });
}

export interface DeleteConventionInput {
  repoId: string;
  id: string;
}

export function useDeleteConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteConventionInput) => api.del<{ ok: boolean }>(`/conventions/${id}`),
    onSuccess: (_d, { repoId, id }) => {
      qc.setQueryData<ConventionCandidate[]>(conventionKeys.forRepo(repoId), (prev) =>
        prev?.filter((c) => c.id !== id),
      );
    },
  });
}

/**
 * Draft skill body assembled from the currently APPROVED candidates. Fetched
 * on demand when the Create-skill modal opens — `enabled` lets the caller
 * gate that.
 */
export function useConventionSkillDraft(repoId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: conventionKeys.draft(repoId),
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: enabled && !!repoId,
    // A conflict/validation error here is meaningful UI state (no approved
    // candidates, name conflict on next fetch), not a transient network blip.
    retry: false,
  });
}

export interface CreateConventionsSkillInput {
  repoId: string;
  input: ConventionSkillCreate;
}

/** Create (or, with `replace_skill_id`, version) the `repo-conventions` skill. */
export function useCreateConventionsSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, input }: CreateConventionsSkillInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, input),
    onSuccess: () => {
      // The new/updated skill now shows up on the Skills page.
      qc.invalidateQueries({ queryKey: skillKeys.all() });
    },
  });
}
