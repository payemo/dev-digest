import type { CSSProperties } from "react";

/**
 * Presentation for BlastRadiusView. Colours are design tokens, never hex.
 * Entries that depend on a prop are functions of it rather than inline objects
 * at the call site, so the component file stays about structure.
 */
export const s = {
  /** `2 symbols · 14 callers · 3 endpoints · 1 cron/jobs`, toggle pushed right. */
  statRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  statValue: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  statSeparator: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  viewToggle: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,

  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 16,
  } satisfies CSSProperties,

  /** One collapsible row per changed symbol. */
  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    cursor: "pointer",
    fontSize: 13.5,
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    display: "inline-flex",
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "rotate(0deg)",
    transition: "transform .12s",
  }),
  symbolName: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  declaredIn: {
    fontSize: 12,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  callerCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  symbolBody: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    // Left edge = header border (1) + padding (10) + chevron (13) + gap (8), so
    // callers line up under the symbol name instead of under the chevron.
    padding: "10px 10px 12px 32px",
  } satisfies CSSProperties,
  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: "0 8px",
    minWidth: 0,
    // Long caller paths have no break opportunities; without this they run
    // past the card's right edge.
    overflowWrap: "anywhere",
    fontSize: 13,
  } satisfies CSSProperties,
  callerSymbol: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** The no-repo-slug fallback: still monospace, but not a control. */
  callerPlain: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,

  noDownstream: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    marginTop: 16,
  } satisfies CSSProperties,

  graphWrap: {
    marginTop: 16,
    overflowX: "auto",
  } satisfies CSSProperties,
  nodeLabel: (color: string): CSSProperties => ({
    fontSize: 11.5,
    fill: color,
  }),
  legend: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  legendDot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
    display: "inline-block",
  }),
} as const;
