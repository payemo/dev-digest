/**
 * PR Brief (L05) — tuning knobs. Every number cites the spec requirement it
 * implements (`specs/03-pr-brief.md`).
 */

/** The schema name the generation call registers — MockLLMProvider keys on it. */
export const BRIEF_SCHEMA_NAME = 'PrBrief';

/** The feature-local system prompt template (loaded via `loadPromptTemplate`). */
export const BRIEF_SYSTEM_PROMPT_FILE = 'brief.system.md';

/** Model call bounds. Generation is ONE structured call (FR-14). */
export const BRIEF_TEMPERATURE = 0.2;
export const BRIEF_TIMEOUT_MS = 60_000;

/** NFR-1 — the whole model input (system + user), in tokens. */
export const INPUT_TOKEN_BUDGET = 8_000;
/** NFR-1 — output cap, in tokens. */
export const OUTPUT_MAX_TOKENS = 1_500;

/**
 * NFR-2 — per-section token ceilings. The keys double as the names written to
 * `truncated_sections`. The ~700 tokens left over go to the always-kept block.
 */
export const SECTION_CEILINGS = {
  files: 2000,
  blast_detail: 1500,
  description: 1000,
  linked_issue: 800,
  project_context: 2000,
} as const;
export type BriefSection = keyof typeof SECTION_CEILINGS;

/** NFR-2 — when the total is still over budget, shrink sections in this order. */
export const SHRINK_ORDER = [
  'project_context',
  'linked_issue',
  'description',
  'blast_detail',
  'files',
] as const satisfies readonly BriefSection[];

/** FR-8(e) — caps applied after validation, keeping the model's order. */
export const MAX_RISKS = 6;
export const MAX_FOCUS = 8;

/** Contracts — the summary is "≤ ~400 characters"; clamped in code. */
export const SUMMARY_MAX_CHARS = 400;

/**
 * NFR-2 — the intent block is always kept, so it gets its own char cap to keep
 * the ~700-token always-kept reserve honest.
 */
export const MAX_INTENT_CHARS = 1_200;
