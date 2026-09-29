import type { ContextDocumentCategory } from "@/lib/types";

/**
 * Category accent, mapped to a design token — never a hex value. Reused by the
 * per-row category tag on both the agent and the skill tab.
 */
export const CATEGORY_COLOR: Record<ContextDocumentCategory, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

/** Order categories are grouped/sorted in, so both tabs agree. */
export const CATEGORY_ORDER: readonly ContextDocumentCategory[] = ["specs", "docs", "insights"];

/** Rows to skeleton while the document list and the attachment set load. */
export const SKELETON_ROWS = 4;
