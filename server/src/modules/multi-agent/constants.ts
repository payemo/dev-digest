/** How many recent matching runs an agent's time/cost estimate averages over. */
export const ESTIMATE_SAMPLE_SIZE = 10;

/** Higher = more severe. Used to pick a group's title and a take's severity. */
export const SEVERITY_RANK: Record<'CRITICAL' | 'WARNING' | 'SUGGESTION', number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

/** Max length of a disagreement take's plain-text note. */
export const NOTE_MAX_CHARS = 160;
