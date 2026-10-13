import type { CSSProperties } from "react";

const td = { padding: "12px 16px", fontSize: 13.5, verticalAlign: "middle" } satisfies CSSProperties;
const muted = { color: "var(--text-muted)" } satisfies CSSProperties;

export const s = {
  row: { borderBottom: "1px solid var(--border)", cursor: "pointer" } satisfies CSSProperties,
  td,
  num: { ...td, fontVariantNumeric: "tabular-nums" } satisfies CSSProperties,
  muted,
  lastRun: { ...td, ...muted } satisfies CSSProperties,
  agentBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
    color: "var(--text-primary)",
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  agentIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    display: "grid",
    placeItems: "center",
    background: "var(--accent-bg)",
    color: "var(--accent)",
    flexShrink: 0,
  } satisfies CSSProperties,
  agentSub: { display: "block", fontSize: 12, fontWeight: 400, color: "var(--text-muted)" } satisfies CSSProperties,
  view: { color: "var(--accent-text)", fontSize: 13 } satisfies CSSProperties,
  details: {
    padding: "12px 16px 16px 54px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
} as const;
