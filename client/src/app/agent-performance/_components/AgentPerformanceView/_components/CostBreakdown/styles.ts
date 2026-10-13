import type { CSSProperties } from "react";

export const s = {
  section: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 } satisfies CSSProperties,
  card: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  cardTitle: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
