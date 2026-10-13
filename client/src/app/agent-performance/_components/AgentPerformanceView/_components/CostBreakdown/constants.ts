/** Slice keys the server uses for runs it can't attribute (mirrors agent-stats/constants.ts). */
export const DELETED_AGENT_KEY = "deleted";
export const UNKNOWN_MODEL_KEY = "unknown";

/** Stable categorical slice colours, in order, from the vendored tokens. */
export const SLICE_COLORS = [
  "var(--crit)",
  "var(--warn)",
  "var(--accent)",
  "var(--ok)",
  "var(--accent-text)",
  "var(--text-secondary)",
] as const;
