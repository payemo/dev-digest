import type { CSSProperties } from "react";

export const s = {
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } satisfies CSSProperties,
  card: (selected: boolean, enabled: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderRadius: 10,
    textAlign: "left",
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    background: selected ? "var(--accent-bg)" : "var(--bg-surface)",
    color: "var(--text-primary)",
    opacity: enabled ? 1 : 0.55,
    cursor: enabled ? "pointer" : "not-allowed",
  }),
  head: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  desc: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  repo: { marginTop: 20, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
