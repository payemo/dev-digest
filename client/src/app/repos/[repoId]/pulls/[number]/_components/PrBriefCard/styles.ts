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
    alignItems: "start",
  } satisfies CSSProperties,
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
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
