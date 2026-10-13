import type { CSSProperties } from "react";

export const s = {
  table: { width: "100%", borderCollapse: "collapse", background: "var(--bg-elevated)" } satisfies CSSProperties,
  wrap: { border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", overflowX: "auto" } satisfies CSSProperties,
  th: {
    padding: "10px 16px",
    textAlign: "left",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  sortBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
    color: "inherit",
    letterSpacing: "inherit",
    textTransform: "inherit",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
