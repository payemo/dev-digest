/**
 * Eval pipeline constants (L06). Imports nothing.
 */

/** NFR-4 — cases executed in parallel within one eval run. */
export const EVAL_CASE_CONCURRENCY = 2;

/** NFR-4 — per-case timeout, so one slow case cannot hang the run. */
export const EVAL_CASE_TIMEOUT_MS = 120_000;

/** FR-5 — maximum length of a generated case name. */
export const EVAL_NAME_MAX = 80;

/** FR-5 — name prefix of a case seeded from an accepted finding. */
export const EVAL_POSITIVE_PREFIX = 'must-find-';

/** FR-5 — name prefix of a case seeded from a dismissed finding. */
export const EVAL_NEGATIVE_PREFIX = 'no-';

/** FR-20 — default time window (days) of the per-agent detail page. */
export const EVAL_DEFAULT_WINDOW_DAYS = 30;

/** FR-21 — a precision drop of at least this many whole points raises the banner. */
export const EVAL_DIP_THRESHOLD_POINTS = 1;

/** FR-19/FR-20 — how many runs the history tables show. */
export const EVAL_RECENT_RUNS_LIMIT = 20;

/** FR-19 — how many completed runs feed a dashboard sparkline. */
export const EVAL_SPARKLINE_POINTS = 10;

/** FR-28 / AC-84 — error recorded on a run that a server restart interrupted. */
export const EVAL_REAPED_ERROR = 'Interrupted by a server restart';

/** FR-6 — note stored on a seeded case's reference-only file entry. */
export const EVAL_FILE_NOTE = 'reference only — not sent to the agent';

/** Per-route rate-limit window of the eval routes that spend model credits. */
export const EVAL_RATE_LIMIT_WINDOW = '1 minute';

/** Max full eval runs started per window (`/agents/:id/eval/runs`, `/eval/runs/all`). */
export const EVAL_RUN_RATE_LIMIT_MAX = 10;

/** Max single-case runs per window (`/eval/cases/:id/run`, manual one-off iteration). */
export const EVAL_CASE_RUN_RATE_LIMIT_MAX = 20;
