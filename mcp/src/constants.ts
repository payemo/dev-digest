/**
 * Every budget, timeout and TTL in this package. Nothing here is a magic
 * number at its use site — if a number needs explaining, it is explained here.
 */

/**
 * The API binds loopback by default (`API_HOST` 127.0.0.1, `API_PORT` 3001 in
 * `server/src/platform/config.ts`). Overridable only via DEVDIGEST_API_URL.
 */
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/**
 * `run_agent_on_pr` blocks for a whole review. `POST /pulls/:id/review` is
 * synchronous, so this is how long a real LLM pass is allowed to take before
 * we hand the agent a "still running, go read findings later" result.
 */
export const REVIEW_TIMEOUT_MS = 120_000;

/** Every other endpoint is a plain DB read; 15s is already generous. */
export const HTTP_TIMEOUT_MS = 15_000;

/**
 * Startup budget: the whole `tools/list` payload must stay under 1500 tokens.
 *
 * This is a CHAR proxy for that token budget, at a deliberately conservative
 * 3.5 chars/token for mixed JSON + English (1500 * 3.5 = 5250). A hermetic
 * test cannot call the real tokenizer — that needs a network call and an API
 * key — and tiktoken is simply wrong for Claude, which it
 * undercounts by 15-20%. The authoritative number comes from the Anthropic
 * token-counting endpoint, run by hand whenever a description changes, and is
 * recorded in INSIGHTS.md next to this constant so the ratio can be
 * re-derived rather than re-guessed.
 */
export const TOOLS_LIST_CHAR_BUDGET = 5250;

/**
 * Final backstop on any single tool result, for a pathological case no
 * per-field rule anticipated. Not a substitute for `limit`.
 */
export const MAX_RESPONSE_CHARS = 12_000;

/** A finding's rationale is markdown of unbounded length. */
export const MAX_RATIONALE_CHARS = 400;

/** A review summary is likewise unbounded. */
export const MAX_SUMMARY_CHARS = 600;

export const DEFAULT_FINDINGS_LIMIT = 20;
export const DEFAULT_CONVENTIONS_LIMIT = 25;

/** An error that lists candidates must not itself blow the budget. */
export const MAX_CANDIDATES_IN_ERROR = 20;

/**
 * Resolution caches. Short, because the point is to make three consecutive
 * tool calls in one turn cheap — not to pin a worldview. A lookup MISS always
 * re-fetches once with the cache bypassed before reporting not-found.
 */
export const REPO_CACHE_TTL_MS = 60_000;
export const AGENT_CACHE_TTL_MS = 60_000;
export const PULL_CACHE_TTL_MS = 30_000;
