/**
 * project-context — module constants. Imports nothing.
 */

/**
 * The convention root inside a repository. Fixed, not configurable: one root
 * across every repository is what makes "drop a PRD here and every agent can
 * read it" a thing a user can be told once.
 */
export const CONTEXT_ROOT = '.devdigest';

/**
 * Directory names that classify a document, wherever they appear in the clone
 * (`.devdigest/docs/`, `server/specs/`, `a/b/insights/`). A document's category
 * IS the directory, so Markdown with no such directory above it (a root
 * `README.md`, `.devdigest/README.md`) has no category and is deliberately NOT
 * discovered — there would be nowhere to render it.
 */
export const CONTEXT_CATEGORIES = ['specs', 'docs', 'insights'] as const;

/**
 * Directories the clone-wide scan never enters. Same set the code index skips,
 * plus `clones` (runtime data) — the scan now starts at the clone root, so
 * without this a vendored tree would be walked and its docs attached.
 */
export const EXCLUDED_SCAN_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  'clones',
  '.git',
]);

/** The only extensions discovered or accepted on intake. */
export const MARKDOWN_EXT = ['.md', '.markdown'] as const;

/**
 * Upper bound on documents held per repository. A scan past it reports how many
 * it dropped rather than silently returning a partial list.
 */
export const MAX_DOCS_PER_REPO = 200;

/** Upper bound on one document, checked before it is read or stored. */
export const MAX_DOC_BYTES = 256_000;

/**
 * How long a completed sync stays `fresh`. Freshness is derived at read time
 * from this, so nothing has to age a stored row.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Upper bound on directory entries (files and directories both) one scan will
 * visit across the whole clone walk. A DoS bound, not a document limit: it is
 * set far above anything a normal-sized source tree reaches (excluded
 * directories do not count), so it only bites on a very large tree.
 */
export const MAX_SCAN_ENTRIES = 50_000;
