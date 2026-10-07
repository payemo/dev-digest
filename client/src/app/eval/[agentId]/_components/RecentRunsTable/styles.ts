import type { CSSProperties } from "react";

const GRID = "32px 140px 50px 1fr 1fr 1fr 80px 70px";

export const s = {
  hint: { fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 8 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  table: { border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg-elevated)" } satisfies CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: GRID,
    alignItems: "center",
    gap: 14,
    padding: "9px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  head: { fontSize: 11.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" } satisfies CSSProperties,
  time: { color: "var(--text-secondary)", fontSize: 12.5 } satisfies CSSProperties,
  version: { color: "var(--accent-text)" } satisfies CSSProperties,
  pass: { fontWeight: 700 } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
