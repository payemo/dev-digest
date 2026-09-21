/** Route-tier constants shared by /skills and /skills/[id]. */

/** Whitelisted tab keys for the ?tab= param — anything else falls back to DEFAULT_TAB. */
export const VALID_TABS = ["config", "preview", "stats", "versions"] as const;
export type SkillTab = (typeof VALID_TABS)[number];
export const DEFAULT_TAB: SkillTab = "config";

/** Left-pane list width, matching the Agents master-detail layout. */
export const LIST_WIDTH = 280;
