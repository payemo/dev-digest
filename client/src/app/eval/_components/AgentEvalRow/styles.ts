import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "14px 18px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    textDecoration: "none",
  } satisfies CSSProperties,
  icon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: "var(--accent-bg)",
    color: "var(--accent)",
    flexShrink: 0,
  } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  name: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  sub: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  spark: { width: 72, display: "flex", justifyContent: "center" } satisfies CSSProperties,
  metric: { width: 64, textAlign: "center" } satisfies CSSProperties,
  metricLabel: { fontSize: 10.5, fontWeight: 600, letterSpacing: "0.05em", color: "var(--text-muted)" } satisfies CSSProperties,
  metricValue: { fontSize: 18, fontWeight: 700, marginTop: 2 } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;
