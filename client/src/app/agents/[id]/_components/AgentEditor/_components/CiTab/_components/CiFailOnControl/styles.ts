import type { CSSProperties } from "react";

export const s = {
  card: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  text: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  title: { fontSize: 13.5, fontWeight: 600, marginBottom: 4 } satisfies CSSProperties,
  body: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  group: {
    display: "inline-flex",
    padding: 3,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-primary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  pill: (active: boolean): CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),
  readOnlyPill: {
    padding: "6px 14px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;
