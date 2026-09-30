import type { CSSProperties } from "react";

/** Presentation for RiskAreas. Colours are design tokens, never hex. */
export const s = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
    gap: 8,
  } satisfies CSSProperties,
  chip: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  chipHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "7px 8px 7px 10px",
    cursor: "pointer",
  } satisfies CSSProperties,
  sevIcon: (color: string): CSSProperties => ({
    display: "inline-flex",
    color,
    marginTop: 2,
    flexShrink: 0,
  }),
  chipText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  chipTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  firstRef: {
    fontSize: 11.5,
    color: "var(--accent-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    display: "inline-flex",
    color: "var(--text-muted)",
    paddingLeft: 6,
    borderLeft: "1px solid var(--border)",
    alignSelf: "stretch",
    alignItems: "center",
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .12s",
  }),
  chipBody: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "0 10px 10px 31px",
  } satisfies CSSProperties,
  explanation: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  refList: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
  } satisfies CSSProperties,
  refButton: {
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 11.5,
    color: "var(--accent-text)",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
