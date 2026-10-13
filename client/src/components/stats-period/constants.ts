/** Periods both stats pages offer. Labels live in `agentPerformance.period.*`. */
export const PERIODS = ["1d", "30d", "custom"] as const;
export type StatsPeriod = (typeof PERIODS)[number];

export const DEFAULT_PERIOD: StatsPeriod = "30d";

/** Rolling length of each preset, in days. */
export const PRESET_DAYS: Record<Exclude<StatsPeriod, "custom">, number> = {
  "1d": 1,
  "30d": 30,
};

/**
 * How often an open page with a rolling preset moves the window's end to
 * "now". Without it the window stays pinned to the minute the page opened, and
 * a run that finishes later falls outside it.
 */
export const ROLLING_REANCHOR_MS = 60_000;

/** Longest custom range, mirroring the server's 366-day cap on the window. */
export const MAX_CUSTOM_DAYS = 366;

/** Search-param names the period lives under (other params are preserved). */
export const PERIOD_PARAM = "period";
export const FROM_PARAM = "from";
export const TO_PARAM = "to";
