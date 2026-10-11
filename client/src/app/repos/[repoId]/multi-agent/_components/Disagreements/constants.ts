/* Disagreements constants: colour tokens + message keys per non-flagged take.
   The did_not_flag note is ONE fixed string for every agent (never per agent). */
export const TAKE_META = {
  did_not_flag: {
    color: "var(--text-secondary)",
    dot: "var(--text-muted)",
    labelKey: "disagree.didNotFlag",
    noteKey: "disagree.didNotFlagNote",
  },
  no_result: {
    color: "var(--failed)",
    dot: "var(--failed)",
    labelKey: "disagree.noResult",
    noteKey: "disagree.noResultNote",
  },
  pending: {
    color: "var(--pending)",
    dot: "var(--pending)",
    labelKey: "disagree.pending",
    noteKey: "disagree.pendingNote",
  },
} as const;
