import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", padding: 24, gap: 20, maxWidth: 1000 } satisfies CSSProperties,
  list: { width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
    background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
    cursor: "pointer",
  }),
  version: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  date: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  body: {
    flex: 1,
    minWidth: 0,
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 20,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
