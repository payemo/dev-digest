/**
 * Lookup maps for BlastRadiusCard (the degraded badge). No English text lives
 * here: every user-facing string is in `messages/en/blast.json`, and this file
 * only carries the KEY to look one up. Colours are CSS custom properties from
 * the vendored token set, never a hex value.
 */

/**
 * `DegradedReason` (server-side, `repo-intel/types.ts`) → its `blast.json` key.
 *
 * Typed as an open `Record<string, string>` on purpose: `reason` crosses the
 * wire as a plain string so that a reason the server learns tomorrow cannot
 * fail response serialization. The consequence here is the `unknown` fallback —
 * a new reason degrades to a generic label instead of a blank badge.
 */
export const REASON_LABEL_KEY: Record<string, string> = {
  flag_off: "degraded.reason.flagOff",
  index_failed: "degraded.reason.indexFailed",
  index_partial: "degraded.reason.indexPartial",
  repo_too_large: "degraded.reason.repoTooLarge",
  no_data: "degraded.reason.noData",
};

export const UNKNOWN_REASON_KEY = "degraded.reason.unknown";

/** The "index incomplete" badge. */
export const DEGRADED_COLOR = "var(--warn)";
