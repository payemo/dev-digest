/**
 * Lookup maps and layout numbers for BlastRadiusView. No English text lives
 * here: every user-facing string is in `messages/en/blast.json`. Colours are
 * CSS custom properties from the vendored token set, never a hex value.
 */

/**
 * An HTTP endpoint reachable from a caller. The blue family of the mockup, but
 * NOT `--accent`: that is the changed-symbol colour, and the graph legend
 * advertises the two as different things, so sharing a token made one of its
 * three dots a duplicate. (`--info` is not an option — it is grey, #6b7280 in
 * both themes; see `vendor/ui/styles.css`.)
 */
export const ENDPOINT_COLOR = "var(--accent-text)";
/** A scheduled job reachable from a caller. Amber, so it reads as "time", not "route". */
export const CRON_COLOR = "var(--warn)";
/** Chips carry an icon as well as a colour — colour alone is never the signal. */
export const ENDPOINT_ICON = "Globe" as const;
export const CRON_ICON = "Clock" as const;

/** Graph columns: changed symbol → its callers → the endpoints they serve. */
export const GRAPH_NODE_COLOR = {
  symbol: "var(--accent)",
  caller: "var(--text-secondary)",
  endpoint: "var(--accent-text)",
} as const;

/** Only the first symbol row starts expanded — the rest are one click away. */
export const EXPANDED_BY_DEFAULT = 1;

/**
 * Hand-rolled SVG layout. Three fixed columns and a fixed row height, because
 * the alternative is a charting dependency for a diagram with at most a handful
 * of nodes.
 */
export const GRAPH = {
  /** Left edge x of each column. */
  colX: [8, 236, 464] as const,
  nodeWidth: 200,
  nodeHeight: 26,
  rowGap: 10,
  padTop: 12,
  padBottom: 12,
  width: 680,
  /** Symbols drawn before the view says "+N more" instead. */
  maxRows: 4,
  /** Caller/endpoint nodes drawn per symbol before the same applies. */
  maxPerColumn: 3,
} as const;
