import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, RiskArea, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * Intent persisted for a PR: the narrative `Intent` plus the evidence that
 * produced it. Every field beyond `Intent` is additive.
 *
 * `confidence` is COMPUTED IN CODE from `sources` (which evidence was actually
 * present), never asked of the model — verbalized model confidence saturates,
 * and this repo never trusts a model's self-reported score. `sources` is the
 * audit trail for that number: markers like `spec:<path>`, `issue:<n>`,
 * `body`, `commits`, `branch`, `paths`, `ticket_ref_unreadable`.
 *
 * `is_stale` is derived on read (`head_sha` ≠ the PR's current head), not
 * stored: new commits can change what a PR is for.
 *
 * `tokens_in`/`tokens_out`/`cost_usd` are the DERIVATION call's own usage.
 * They are deliberately NOT folded into `agent_runs` — one derivation serves
 * every queued run of that PR, so adding it there would multiply-count it.
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  confidence: z.number(),
  risk_areas: z.array(RiskArea),
  sources: z.array(z.string()),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  derived_at: z.string(),
  head_sha: z.string().nullish(),
  is_stale: z.boolean(),
  tokens_in: z.number().int().nullish(),
  tokens_out: z.number().int().nullish(),
  cost_usd: z.number().nullish(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
