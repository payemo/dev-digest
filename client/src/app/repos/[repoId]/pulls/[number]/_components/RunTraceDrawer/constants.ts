/** Constants for the Run Trace + Live Log drawer (A5). */

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;

/** Live-log stream viewport height (px). */
export const LOG_HEIGHT = 420;

/** Tab keys (Trace / Live log). */
export const TABS = ["trace", "log"] as const;
export type TraceTab = (typeof TABS)[number];

/**
 * Prompt-assembly block accent colours, in the order the ENGINE assembles
 * them: system → pr_description → intent → skills → memory → repo_map →
 * specs (`## Project context`) → callers → user. The drawer renders them in
 * this order so the list cannot misstate where a slot actually lands.
 */
export const PROMPT_COLORS = {
  system: "var(--text-muted)",
  prDescription: "var(--text-secondary)",
  intent: "var(--warn)",
  skills: "var(--accent)",
  memory: "var(--warn)",
  repoMap: "var(--accent)",
  specs: "var(--text-secondary)",
  callers: "var(--warn)",
  user: "var(--ok)",
} as const;
