import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600, marginBottom: 10 } satisfies CSSProperties,
  chips: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  radios: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  radio: { display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, cursor: "pointer" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--crit)", marginTop: 8 } satisfies CSSProperties,
  note: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  noteIcon: { flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
} as const;
