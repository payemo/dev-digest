import type { ContextDocumentCategory } from "@/lib/types";

/** Category grouping order on the page — the same order the root uses on disk. */
export const CATEGORY_ORDER: readonly ContextDocumentCategory[] = ["specs", "docs", "insights"];

/** Category accent, mapped to a design token. Never a hex value. */
export const CATEGORY_COLOR: Record<ContextDocumentCategory, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

/** Health → token for the footer's status dot. */
export const HEALTH_COLOR = {
  fresh: "var(--ok)",
  stale: "var(--text-muted)",
  bounded: "var(--warn)",
  failed: "var(--crit)",
} as const;

/** Rows to skeleton while the list loads. */
export const SKELETON_ROWS = 5;

/**
 * Client-side mirrors of the server's intake bounds, so a rejection is
 * explained before a round trip. The server's validation stays authoritative —
 * these only ever produce a friendlier message, never an allowance.
 */
export const MAX_DOC_BYTES = 256_000;
export const MARKDOWN_EXT = [".md", ".markdown"] as const;
