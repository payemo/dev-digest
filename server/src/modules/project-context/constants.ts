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
 * The immediate subdirectories of the root that classify a document. A
 * document's category IS its directory, so Markdown directly under the root
 * (e.g. `.devdigest/README.md`) has no category and is deliberately NOT
 * discovered — there would be nowhere to render it.
 */
export const CONTEXT_CATEGORIES = ['specs', 'docs', 'insights'] as const;

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
 * visit across all three categories. A DoS bound, not a document limit: it is
 * set far above anything a normal-sized document area reaches, so it only bites
 * when the walk has somehow been pointed at a very large tree.
 */
export const MAX_SCAN_ENTRIES = 10_000;
