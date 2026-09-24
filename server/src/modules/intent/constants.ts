/**
 * Intent derivation — tuning knobs.
 *
 * Every cap here exists because the corresponding source is UNTRUSTED and,
 * for the linked issue and the referenced spec file, attacker-controllable:
 * anyone who can open a PR can point it at an issue body or a file in the
 * repo. `MAX_PR_DESCRIPTION_CHARS = 4000` in `reviewer-core/src/prompt.ts` is
 * the precedent — a source that reaches a prompt gets a size cap.
 */

/** Model call bounds. Derivation is ONE structured call per PR head SHA. */
export const INTENT_TEMPERATURE = 0.1;
export const INTENT_MAX_TOKENS = 1_200;
export const INTENT_TIMEOUT_MS = 60_000;

/** How many referenced plan/spec files we are willing to read off the clone. */
export const MAX_SPEC_FILES = 2;
/** Per-spec-file cap on what reaches the prompt. */
export const MAX_SPEC_CHARS = 4_000;
/** Cap on the linked issue's body. */
export const MAX_ISSUE_BODY_CHARS = 2_000;
/** Cap on the PR body. */
export const MAX_BODY_CHARS = 4_000;
/** How many (meaningful) commit messages are worth their tokens. */
export const MAX_COMMIT_MESSAGES = 20;
/** How many changed paths go into the prompt — also the risk-evidence allowlist. */
export const MAX_PATHS = 60;

/**
 * The ONLY directory prefixes a referenced spec may live under. This is an
 * allowlist, not a denylist: `isSafeSpecPath` requires a match, so a path that
 * escapes the guard's imagination is rejected rather than read.
 * `SimpleGitClient.readFile` joins the caller's path straight onto the clone
 * directory with no traversal guard of its own, so this guard is the whole
 * defense at this call site.
 */
export const SPEC_PATH_PREFIXES = ['docs/plans/', 'docs/specs/', 'specs/'] as const;

/**
 * D3 — confidence is computed from WHICH EVIDENCE WAS PRESENT, never asked of
 * the model. Verbalized model confidence is prompt-dependent and saturates at
 * 0.8/0.9/1.0, worst on exactly the cheap models this feature runs on; and
 * this repo's standing rule is that a model's self-reported score is never
 * trusted.
 *
 * Keyed by the marker KIND recorded in `pr_intent.sources` (the part before
 * `:` for `spec:<path>` / `issue:<n>`). Tiers 1-3 (`spec`, `issue`, `body`)
 * are the "real documentation" set: with none of them present the maximum
 * reachable score is 0.10 + 0.05 + 0.05 = 0.20, which is `low` by
 * construction — the requirement "build it from indirect signals and mark it
 * lower confidence" enforced by arithmetic rather than by asking the model.
 *
 * `ticket_ref_unreadable` (a Jira/Linear key we detected but cannot fetch)
 * deliberately carries NO weight — it is recorded so the user can see why the
 * confidence is low, not as evidence.
 */
export const CONFIDENCE_WEIGHTS: Record<string, number> = {
  spec: 0.3,
  issue: 0.25,
  body: 0.25,
  commits: 0.1,
  branch: 0.05,
  paths: 0.05,
};

/** Never 1.0 (nothing here is certain) and never 0 (we did derive something). */
export const CONFIDENCE_MIN = 0.05;
export const CONFIDENCE_MAX = 0.95;

/** D3 bands. Mirrored in `reviewer-core/src/prompt.ts`'s heading caveat. */
export const CONFIDENCE_BANDS = { high: 0.7, medium: 0.4 } as const;

/** `hasRealDocumentation` thresholds — see the helper for what is stripped first. */
export const MIN_DOCUMENTATION_CHARS = 120;
export const MIN_SENTENCE_WORDS = 6;

/** A commit list this short is a signal about nothing. D3 weights `commits` at ≥2. */
export const MIN_MEANINGFUL_COMMITS = 2;

/** A branch name has to tokenize into at least this many word-ish segments. */
export const MIN_BRANCH_TOKENS = 2;

/** The schema name the derivation call registers — MockLLMProvider keys on it. */
export const INTENT_SCHEMA_NAME = 'PrIntent';

/** The feature-local system prompt template (loaded via `loadPromptTemplate`). */
export const INTENT_SYSTEM_PROMPT_FILE = 'intent.system.md';
