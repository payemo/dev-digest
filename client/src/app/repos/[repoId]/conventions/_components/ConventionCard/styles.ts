import type { CSSProperties } from "react";

export const s = {
  card: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "flex-start", gap: 16 } satisfies CSSProperties,
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  ruleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  rule: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)", fontStyle: "italic" } satisfies CSSProperties,
  evidenceRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  excerpt: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    lineHeight: 1.6,
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  confidenceRow: { maxWidth: 220 } satisfies CSSProperties,
  actions: { display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, width: 128 } satisfies CSSProperties,
  editRow: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  editActions: { display: "flex", gap: 8 } satisfies CSSProperties,
};
