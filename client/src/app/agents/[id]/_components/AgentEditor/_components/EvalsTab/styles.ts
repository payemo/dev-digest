import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: 24, maxWidth: 1000, display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  link: { fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  casesHeader: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  headerActions: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  progressBox: {
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
} as const;
