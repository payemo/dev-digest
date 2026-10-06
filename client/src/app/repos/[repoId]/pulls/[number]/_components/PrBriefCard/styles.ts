import type { CSSProperties } from "react";

/** Presentation for PrBriefCard. Colours are design tokens, never hex. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  /** Intent + risks on the left, blast radius on the right; stacks when narrow. */
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 16,
    alignItems: "stretch",
  } satisfies CSSProperties,
  /** Grid items may shrink below their content, so long refs never push the card wider. */
  cell: {
    minWidth: 0,
  } satisfies CSSProperties,
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  /** The left card sets the row height; the blast card matches it and scrolls inside. */
  blastCard: {
    position: "relative",
    minWidth: 0,
    minHeight: 320,
  } satisfies CSSProperties,
  blastScroll: {
    position: "absolute",
    inset: 0,
    overflow: "auto",
    padding: "var(--card-pad)",
  } satisfies CSSProperties,
  divider: {
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  inputsLine: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
  } satisfies CSSProperties,
  errorRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 13,
  } satisfies CSSProperties,
  errorAction: {
    marginLeft: "auto",
  } satisfies CSSProperties,
  emptyCta: {
    marginTop: 14,
    display: "flex",
    justifyContent: "center",
  } satisfies CSSProperties,
  muted: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
