import { z } from 'zod';
import { ConventionCandidate, ConventionCategory, ConventionStatus, SkillType } from './knowledge.js';

/**
 * Conventions Extractor — request/response DTOs for the extraction, triage and
 * skill-assembly flow.
 *
 * NEW file (the barrel re-exports it), same split as `skills.ts`:
 * `ConventionCandidate`, `ConventionStatus`, `ConventionCategory` live in
 * `knowledge.ts` (the entity), this file adds what the module needs on top.
 *
 * Wire casing is snake_case throughout, matching the SQL columns.
 */

// ---------------------------------------------------------------------------
// POST /repos/:id/conventions/extract
// ---------------------------------------------------------------------------

/**
 * Result of one scan. `candidates` is the WHOLE board after the scan (earlier
 * accepted/rejected rows included), not just the newly-proposed ones — the
 * page renders every status from one response.
 */
export const ConventionExtractResult = z.object({
  candidates: z.array(ConventionCandidate),
  sampled_files: z.array(z.string()),
  /** How many the model proposed, before the evidence gate ran. */
  proposed: z.number().int(),
  /** Dropped because their citation didn't check out (unknown file, line, or quote mismatch). */
  dropped_ungrounded: z.number().int(),
  /** Dropped because the rule already exists (this scan or a decided earlier one). */
  dropped_duplicate: z.number().int(),
  model: z.string(),
  cost_usd: z.number().nullable(),
});
export type ConventionExtractResult = z.infer<typeof ConventionExtractResult>;

// ---------------------------------------------------------------------------
// PATCH /conventions/:id
// ---------------------------------------------------------------------------

export const ConventionUpdate = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().min(1).optional(),
    category: ConventionCategory.optional(),
    rationale: z.string().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type ConventionUpdate = z.infer<typeof ConventionUpdate>;

// ---------------------------------------------------------------------------
// GET /repos/:id/conventions/skill-draft · POST /repos/:id/conventions/skill
// ---------------------------------------------------------------------------

/**
 * An un-persisted skill assembled from the currently APPROVED candidates.
 * `existing_skill_id` is set when the workspace already has a skill named
 * `repo-conventions` — the modal uses it to offer "replace" instead of a
 * silent duplicate or a silent overwrite.
 */
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  enabled: z.boolean(),
  body: z.string(),
  evidence_files: z.array(z.string()),
  convention_ids: z.array(z.string()),
  existing_skill_id: z.string().nullable(),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

/**
 * The user-edited draft, posted back verbatim — the persisted body is what the
 * user reviewed, never silently regenerated server-side.
 */
export const ConventionSkillCreate = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType.optional(),
  enabled: z.boolean().optional(),
  body: z.string().min(1),
  convention_ids: z.array(z.string()).min(1),
  /** Confirms replacing an existing `repo-conventions` skill (409 without it). */
  replace_skill_id: z.string().nullable().optional(),
});
export type ConventionSkillCreate = z.infer<typeof ConventionSkillCreate>;
