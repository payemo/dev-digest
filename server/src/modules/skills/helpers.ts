import type { Skill, SkillSource, SkillStats, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { STATS_WINDOW_DAYS } from './constants.js';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping, the version-bump
 * rule, the vetting rule, and stats aggregation. No I/O.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch changes the skill BODY — the only field whose change bumps
 * the version and snapshots `skill_versions`. Renaming a skill, rewording its
 * description or toggling `enabled` leaves the version alone, because none of
 * those change what the model is told.
 */
export function isBodyChange(
  existing: Pick<SkillRow, 'body'>,
  patch: { body?: string },
): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

/**
 * Whether a skill from this source may be enabled at creation time.
 *
 * A skill body is injected into the prompt as INSTRUCTIONS — it is the one
 * block `assemblePrompt` deliberately does not wrap in <untrusted> delimiters.
 * So anything that did not come from a human typing it here arrives disabled
 * and stays that way until someone reads it and enables it by hand.
 */
export function mayBeEnabledOnCreate(source: SkillSource): boolean {
  return source === 'manual';
}

/** Raw aggregate rows the repository feeds into `computeSkillStats`. */
export interface SkillStatsInput {
  skillId: string;
  usedByAgents: number;
  linkedAgentRuns: number;
  injectedRuns: number;
  accepted: number;
  dismissed: number;
  byCategory: { category: string; count: number }[];
}

/** Percentage, or null when the denominator is zero. Never collapses to 0%. */
function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Fold the repository's aggregates into the `SkillStats` DTO.
 *
 * Two deliberate choices, both load-bearing:
 *  - A zero denominator yields `null`, not 0 — "no data yet" and "0%" are
 *    different claims and the UI renders them differently ("—" vs "0%").
 *  - `linked_agent_runs` counts only runs that recorded attribution at all
 *    (i.e. after run_skills existed). Counting older runs would make every
 *    skill's pull frequency read artificially low forever.
 */
export function computeSkillStats(input: SkillStatsInput): SkillStats {
  const findings = input.byCategory.reduce((sum, c) => sum + c.count, 0);
  const triaged = input.accepted + input.dismissed;
  return {
    skill_id: input.skillId,
    window_days: STATS_WINDOW_DAYS,
    used_by_agents: input.usedByAgents,
    linked_agent_runs: input.linkedAgentRuns,
    injected_runs: input.injectedRuns,
    pull_frequency_pct: pct(input.injectedRuns, input.linkedAgentRuns),
    findings,
    accepted: input.accepted,
    dismissed: input.dismissed,
    accept_rate: pct(input.accepted, triaged),
    // Biggest category first, then alphabetically so the donut's slice order is
    // stable across reloads when two categories tie.
    by_category: [...input.byCategory].sort(
      (a, b) => b.count - a.count || a.category.localeCompare(b.category),
    ),
  };
}
