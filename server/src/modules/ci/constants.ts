/**
 * Export-to-CI + CI ingest constants. The generated workflow, the exported
 * paths and the ingest's size caps all key off these, so the runner side
 * (`agent-runner`) and the studio side agree on one set of names.
 */

/** The only branch the wizard ever writes to — never the default branch. */
export const CI_BRANCH = 'devdigest/ci' as const;
export const CI_PR_TITLE = 'Add DevDigest CI review';

/** The ncc bundle is ESM; `.mjs` makes Node load it as ESM in any target repo. */
export const CI_RUNNER_PATH = '.devdigest/runner.mjs';
export const CI_MEMORY_PATH = '.devdigest/memory.jsonl';

/** Name of the uploaded artifact and the single file read out of it. */
export const CI_ARTIFACT_NAME = 'devdigest-result';
export const CI_RESULT_FILE = 'devdigest-result.json';

/** Bump when the generated workflow template changes shape. */
export const CI_WORKFLOW_TEMPLATE_VERSION = 1;
export const CI_NODE_VERSION = '22';

/** Ingest size caps (see the plan's Security model, I7 and V2). */
export const CI_ARTIFACT_MAX_ZIP_BYTES = 256 * 1024;
export const CI_ARTIFACT_MAX_JSON_BYTES = 1024 * 1024;
export const CI_REGROUND_MAX_DIFF_BYTES = 2 * 1024 * 1024;
export const CI_SYNC_RUNS_PER_INSTALLATION = 30;

/** Max characters of a user-edited workflow (mirrors the contract's cap). */
export const CI_WORKFLOW_MAX_CHARS = 20_000;
/** Max memory items exported into `memory.jsonl` (the runner caps at 200 too). */
export const CI_MEMORY_MAX_ITEMS = 200;

export const CI_SUPPORTED_TARGETS = ['gha'] as const;
export const CI_SUPPORTED_PROVIDERS = ['openrouter'] as const;

/** The CI secret the target repo must define. */
export const CI_SECRET_NAMES = ['OPENROUTER_API_KEY'] as const;

/**
 * `.devdigest/<dir>/` names the project-context scanner treats as repository
 * documents. Exported slugs never take these names.
 */
export const CI_RESERVED_DIRS = ['specs', 'docs', 'insights'] as const;

/** Route rate limits (same window as the eval routes). */
export const CI_RATE_LIMIT_WINDOW = '1 minute';
export const CI_EXPORT_RATE_LIMIT_MAX = 6;
export const CI_SYNC_RATE_LIMIT_MAX = 12;

/** Recent runs shown on the agent's CI tab; max rows on the CI Runs page. */
export const CI_OVERVIEW_RECENT_RUNS = 5;
export const CI_RUNS_LIST_LIMIT = 200;

/** Error recorded on a failed CI run that uploaded no result artifact. */
export const CI_FAILED_NO_ARTIFACT_ERROR = 'runner failed in CI (no result artifact)';
