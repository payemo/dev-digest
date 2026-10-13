/**
 * Minimum accept/dismiss decisions before an agent's accept rate is ranked or
 * trended. Below 10 the 95% Wilson interval on a proportion is wider than ±25
 * points (5 of 7 = 71% → roughly 36–92%), so sorting or drawing an arrow on it
 * is noise. 10 is still reachable within days in a lightly used workspace.
 */
export const MIN_DECISIONS_FOR_RANKING = 10;

/** Cost-slice key for done runs whose agent has since been deleted. */
export const DELETED_AGENT_KEY = 'deleted';
export const DELETED_AGENT_LABEL = 'Deleted agent';

/** Cost-slice key for done runs that recorded no model. */
export const UNKNOWN_MODEL_KEY = 'unknown';
export const UNKNOWN_MODEL_LABEL = 'Unknown model';
