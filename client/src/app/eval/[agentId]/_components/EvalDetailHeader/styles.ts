import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  back: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  actions: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  progress: { padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-surface)" } satisfies CSSProperties,
} as const;
