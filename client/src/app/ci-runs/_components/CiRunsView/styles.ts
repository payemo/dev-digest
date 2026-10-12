import type { CSSProperties } from "react";
import { GRID } from "./constants";

export const s = {
  actions: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  auto: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  dot: { width: 7, height: 7, borderRadius: 99, background: "var(--ok)" } satisfies CSSProperties,
  table: { border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", overflowX: "auto" } satisfies CSSProperties,
  head: {
    display: "grid",
    gridTemplateColumns: GRID,
    gap: 12,
    padding: "10px 16px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    minWidth: 1100,
  } satisfies CSSProperties,
} as const;
