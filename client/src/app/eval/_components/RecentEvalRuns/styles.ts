import type { CSSProperties } from "react";

const GRID = "minmax(140px, 1.3fr) 140px 50px 1fr 1fr 1fr 70px";

export const s = {
  table: { border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg-elevated)" } satisfies CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: GRID,
    alignItems: "center",
    gap: 14,
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  agent: { fontWeight: 600 } satisfies CSSProperties,
  time: { color: "var(--text-secondary)", fontSize: 12.5 } satisfies CSSProperties,
  version: { color: "var(--accent-text)" } satisfies CSSProperties,
  pass: { fontWeight: 700, textAlign: "right" } satisfies CSSProperties,
} as const;
