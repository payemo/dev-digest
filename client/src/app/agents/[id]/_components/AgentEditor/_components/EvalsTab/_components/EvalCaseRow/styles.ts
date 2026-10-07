import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  name: { fontSize: 13.5, fontWeight: 700 } satisfies CSSProperties,
  kindBadge: { fontSize: 10.5, letterSpacing: "0.05em", padding: "1px 7px" } satisfies CSSProperties,
  sub: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  chip: { fontSize: 11.5, fontWeight: 500 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 2 } satisfies CSSProperties,
} as const;
