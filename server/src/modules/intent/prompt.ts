import { z } from 'zod';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { renderIntentSources, type IntentSignals } from './helpers.js';

/**
 * The derivation call: ONE structured request over signals the code collected.
 * The model never browses the repo and never chooses what it reads.
 *
 * This schema is a FEATURE-LOCAL model contract, not a wire contract — the HTTP
 * shape is `PrIntentRecord` in `vendor/shared/contracts/review-api.ts`. It
 * deliberately does not live there: what we ask a model for and what we serve
 * over HTTP are different things (the served record carries a code-computed
 * confidence the model is never shown).
 */
export const PrIntentSchema = z.object({
  /**
   * Field ORDER is generation order in a structured response, so the narrative
   * is written BEFORE the labels that summarize it. The conventions scan
   * showed a model committing to a classification before it knew what it was
   * about to say, and every candidate came back identically labelled.
   * DO NOT REORDER these fields.
   */
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  /**
   * `evidence_path` is a CLAIM, verified in code against the PR's real changed
   * paths (see `verifyRiskAreas`); an uncited or wrongly-cited risk is dropped.
   */
  risk_areas: z
    .array(
      z.object({
        label: z.string(),
        evidence_path: z.string().nullish(),
      }),
    )
    .max(8),
  // NO confidence field, on purpose (D3): confidence is computed in code from
  // which evidence was present. Asking a cheap model to score itself yields a
  // saturated 0.8/0.9/1.0 that means nothing.
});
export type PrIntentProposal = z.infer<typeof PrIntentSchema>;

/**
 * The user message: a short trusted framing line, then every collected signal
 * inside ONE `<untrusted>` block. A linked issue body and a referenced spec
 * file are attacker-controllable, so they never reach the model unwrapped.
 */
export function buildUserPrompt(repoFullName: string, prNumber: number, signals: IntentSignals): string {
  return [
    `Repository: ${repoFullName}`,
    `Pull request: #${prNumber}`,
    '',
    'EVIDENCE (ordered: referenced specs, linked issue, PR description, PR facts, commits, changed files)',
    wrapUntrusted('pr-signals', renderIntentSources(signals)),
  ].join('\n');
}
