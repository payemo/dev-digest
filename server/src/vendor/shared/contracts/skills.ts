import { z } from 'zod';
import { SkillType, SkillSource } from './knowledge.js';

/**
 * Skills — create/update DTOs, immutable body versions, and usage stats.
 *
 * NEW file (the barrel re-exports it). `Skill`, `SkillType`, `SkillSource` and
 * `AgentSkillLink` already live in `knowledge.ts` and are NOT touched here —
 * this file only adds what the Skills module needs on top of them.
 *
 * Wire casing is snake_case throughout, matching the SQL columns.
 */

// ---------------------------------------------------------------------------
// Create / update  (POST /skills, PUT /skills/:id — used directly as the route
// body schemas, so the client and the server validate the same shape)
// ---------------------------------------------------------------------------

export const SkillCreate = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType.optional(),
  source: SkillSource.optional(),
  body: z.string().min(1),
  /**
   * Requested enabled state. IGNORED for any `source` other than 'manual' —
   * an imported skill is always stored disabled until a human vets it, because
   * a skill body reaches the model as instructions, not as delimiter-wrapped
   * data (see reviewer-core's assemblePrompt).
   */
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});
export type SkillCreate = z.infer<typeof SkillCreate>;

export const SkillUpdate = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});
export type SkillUpdate = z.infer<typeof SkillUpdate>;

// ---------------------------------------------------------------------------
// Versions  (GET /skills/:id/versions)
// ---------------------------------------------------------------------------

/** An immutable snapshot of a skill's body, taken whenever the body changes. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// ---------------------------------------------------------------------------
// Usage + stats  (GET /skills/:id/agents, GET /skills/:id/stats)
// ---------------------------------------------------------------------------

/** One agent this skill is linked to, with its position in that agent's order. */
export const SkillAgentUsage = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  /** The AGENT's enabled flag, not the link's — agent_skills has no such column. */
  enabled: z.boolean(),
  order: z.number().int(),
});
export type SkillAgentUsage = z.infer<typeof SkillAgentUsage>;

export const SkillCategoryCount = z.object({
  category: z.string(),
  count: z.number().int(),
});
export type SkillCategoryCount = z.infer<typeof SkillCategoryCount>;

/**
 * Per-skill usage stats over a rolling window.
 *
 * CORRELATION, NOT CAUSATION: findings/accept numbers cover runs in which this
 * skill was injected. A finding in such a run was not necessarily caused by the
 * skill — the UI must say "in runs with this skill", never "found by".
 *
 * Both the numerator and the denominator are exposed rather than just a
 * percentage, so the UI can render "12 of 40 runs" and so a null rate can never
 * be silently displayed as 0%.
 */
export const SkillStats = z.object({
  skill_id: z.string(),
  window_days: z.number().int(),
  /** Agents that currently link this skill (from agent_skills). */
  used_by_agents: z.number().int(),
  /**
   * Denominator: runs in the window, by agents linking this skill, that
   * recorded skill attribution at all. Runs from before the run_skills table
   * existed are excluded — otherwise pull frequency reads low forever.
   */
  linked_agent_runs: z.number().int(),
  /** Numerator: runs in which this skill actually entered the prompt. */
  injected_runs: z.number().int(),
  /** injected_runs / linked_agent_runs as a percentage; null when the denominator is 0. */
  pull_frequency_pct: z.number().nullable(),
  findings: z.number().int(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  /** accepted / (accepted + dismissed) as a percentage; null when nothing was triaged. */
  accept_rate: z.number().nullable(),
  by_category: z.array(SkillCategoryCount),
});
export type SkillStats = z.infer<typeof SkillStats>;
