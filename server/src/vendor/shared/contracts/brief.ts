import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

/**
 * One risk area the intent derivation proposed, with the changed-file path it
 * cites as evidence. The citation is VERIFIED in code against the PR's real
 * changed paths before the risk is persisted — a risk whose `evidence_path` is
 * not one of them is dropped, so this field is a claim to be checked, never a
 * fact. `null` is possible on rows written before verification tightened.
 */
export const RiskArea = z.object({
  label: z.string(),
  evidence_path: z.string().nullish(),
});
export type RiskArea = z.infer<typeof RiskArea>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

/**
 * The wire shape of `GET /pulls/:id/blast`: the map above, plus whether the
 * repo index was usable when it was built.
 *
 * It EXTENDS `BlastRadius` rather than widening it, so `PrBrief` — which
 * composes `BlastRadius` below — keeps its exact shape. A brief has no use for
 * "was the index usable?"; a live endpoint does, because the repo-intel facade
 * never throws and answers an unusable index with empty arrays. Without these
 * two fields the client cannot tell "nothing calls this" from "we could not
 * look", which are opposite conclusions for a reviewer.
 *
 * `reason` is a plain `z.string()`, NOT a closed enum over the five known
 * `DegradedReason` members. This schema is declared as the route's
 * `response.200`, so a reason value outside a closed enum would fail
 * serialization and 500 — on the one path whose whole contract is "never
 * throws". Type safety is kept where it matters: the server assigns from the
 * narrowly-typed `BlastResult.reason`, so a typo is still a compile error, and
 * the client maps known reasons to labels with a generic fallback.
 */
export const BlastRadiusResponse = BlastRadius.extend({
  /** True when the index was unusable or incomplete — results may be partial. */
  degraded: z.boolean().optional(),
  /** Why it degraded (a `DegradedReason` value; open on the wire — see above). */
  reason: z.string().optional(),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  /**
   * Each entry is `path`, `path:line` or `path:start-end`. Only the PATH part
   * is validated (against the PR's changed files and its blast map); a ref
   * whose path fails is stripped before the brief is stored.
   */
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
/**
 * The role a changed file plays in a PR. The order of the values here IS the
 * DISPLAY order — `core` first, `boilerplate` last — and every `SmartDiff`
 * response carries all five groups in it, including empty ones.
 *
 * The *matching* order is a separate concern and deliberately differs: a
 * classifier walks its patterns boilerplate → tests → wiring → docs, with
 * `core` as the fallthrough. It is owned by
 * `server/src/modules/smart-diff/constants.ts` (`ROLE_PATTERNS`), not by this
 * enum. Conflating the two is the bug this note exists to prevent.
 */
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Review focus ----
/**
 * One "read this first" pointer. `line` has NO positive bound here on purpose:
 * this shape is also part of the model's output schema, and a bound there
 * would turn a slightly-off answer into paid schema retries. The server snaps
 * every line to a real anchor (always >= 1) before anything is stored.
 */
export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/**
 * What the single brief generation call asks the model for. Shape only — no
 * array caps, no length bounds: capping, snapping and dedupe happen in code
 * AFTER validation. Field order is generation order, so the summary is written
 * before the risks and focus items that follow from it. DO NOT REORDER.
 */
export const PrBriefModelOutput = z.object({
  summary: z.string(),
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});
export type PrBriefModelOutput = z.infer<typeof PrBriefModelOutput>;

// ---- Composed PR Brief (pr_brief.json) ----
/**
 * `intent` / `blast` are the SNAPSHOT the model saw, `null` when that input
 * was missing at generation time. `history` is always empty for now (prior
 * PRs are out of scope).
 */
export const PrBrief = z.object({
  summary: z.string(),
  intent: Intent.nullable(),
  blast: BlastRadius.nullable(),
  risks: Risks,
  review_focus: z.array(ReviewFocusItem),
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

/** How one generation input looked when the brief was generated. */
export const BriefInputStatus = z.enum(['present', 'missing', 'partial', 'stale']);
export type BriefInputStatus = z.infer<typeof BriefInputStatus>;

/** Every input, always all five keys — an explicit object, not a record. */
export const BriefInputs = z.object({
  intent: BriefInputStatus,
  blast: BriefInputStatus,
  description: BriefInputStatus,
  linked_issue: BriefInputStatus,
  project_context: BriefInputStatus,
});
export type BriefInputs = z.infer<typeof BriefInputs>;

/** What post-validation removed or changed in the model's answer. */
export const BriefValidation = z.object({
  risks_dropped: z.number().int().nonnegative(),
  refs_stripped: z.number().int().nonnegative(),
  focus_dropped: z.number().int().nonnegative(),
  focus_snapped: z.number().int().nonnegative(),
  duplicates_collapsed: z.number().int().nonnegative(),
});
export type BriefValidation = z.infer<typeof BriefValidation>;

/** Exactly what `pr_brief.json` holds: the brief plus its provenance. */
export const PrBriefStored = PrBrief.extend({
  pr_id: z.string(),
  head_sha: z.string(),
  generated_at: z.string(),
  provider: z.string(),
  model: z.string().nullish(),
  attempts: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
  input_tokens_measured: z.number().int(),
  truncated_sections: z.array(z.string()),
  inputs: BriefInputs,
  validation: BriefValidation,
});
export type PrBriefStored = z.infer<typeof PrBriefStored>;

/**
 * The wire shape of `GET` / `POST /pulls/:id/brief`. `is_stale` is derived on
 * read (stored head SHA vs the PR's current head) and never stored.
 */
export const PrBriefRecord = PrBriefStored.extend({
  is_stale: z.boolean(),
});
export type PrBriefRecord = z.infer<typeof PrBriefRecord>;
