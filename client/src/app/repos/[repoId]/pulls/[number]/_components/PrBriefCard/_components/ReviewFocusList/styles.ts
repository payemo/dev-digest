import type { CSSProperties } from "react";

/** Presentation for ReviewFocusList. Colours are design tokens, never hex. */
export const s = {
  heading: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    width: "100%",
    background: "none",
    border: "none",
    padding: "6px 4px",
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
    fontSize: 13,
  } satisfies CSSProperties,
  bullet: {
    color: "var(--accent-text)",
    fontSize: 10,
  } satisfies CSSProperties,
  ref: {
    color: "var(--accent-text)",
    fontWeight: 600,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  reason: {
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
