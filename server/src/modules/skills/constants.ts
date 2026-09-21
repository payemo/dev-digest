/** Constants for the skills module. */

/** Initial body version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Skill type when none is supplied on create. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/** Skill source when none is supplied on create. */
export const DEFAULT_SKILL_SOURCE = 'manual' as const;

/** Rolling window (days) that GET /skills/:id/stats reports over. */
export const STATS_WINDOW_DAYS = 30;
