/* hooks/skills.ts — React Query hooks for the Skills page + Skill editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Skill,
  SkillAgentUsage,
  SkillCreate,
  SkillStats,
  SkillUpdate,
  SkillVersion,
} from "@devdigest/shared";
import { skillKeys } from "./keys";

export interface SkillsFilter {
  q?: string;
  type?: Skill["type"];
  source?: Skill["source"];
  enabled?: boolean;
}

function toQueryString(filter: SkillsFilter): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.type) params.set("type", filter.type);
  if (filter.source) params.set("source", filter.source);
  if (filter.enabled !== undefined) params.set("enabled", String(filter.enabled));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useSkills(filter: SkillsFilter = {}) {
  return useQuery({
    queryKey: [...skillKeys.all(), filter],
    queryFn: () => api.get<Skill[]>(`/skills${toQueryString(filter)}`),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.detail(id),
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillCreate) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillKeys.all() }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: SkillUpdate;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: skillKeys.all() });
      qc.setQueryData(skillKeys.detail(data.id), data);
      // A body change adds a version; enabled/name/description also change
      // what the Versions and Agents tabs show for this skill.
      qc.invalidateQueries({ queryKey: skillKeys.versions(data.id) });
      qc.invalidateQueries({ queryKey: skillKeys.agents(data.id) });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: skillKeys.all() });
      qc.removeQueries({ queryKey: skillKeys.detail(id) });
      qc.removeQueries({ queryKey: skillKeys.versions(id) });
      qc.removeQueries({ queryKey: skillKeys.stats(id) });
      qc.removeQueries({ queryKey: skillKeys.agents(id) });
    },
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.versions(id),
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Usage stats over the rolling window. Correlational — see SkillStats's own
 *  doc comment: findings/accept numbers describe runs the skill was injected
 *  into, not findings the skill caused. */
export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.stats(id),
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useSkillAgents(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.agents(id),
    queryFn: () => api.get<SkillAgentUsage[]>(`/skills/${id}/agents`),
    enabled: !!id,
  });
}
