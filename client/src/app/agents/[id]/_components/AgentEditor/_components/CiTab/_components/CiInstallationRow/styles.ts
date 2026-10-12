import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  icon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  repo: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  right: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 } satisfies CSSProperties,
  time: { fontSize: 12.5, color: "var(--text-muted)", minWidth: 56, textAlign: "right" } satisfies CSSProperties,
  link: {
    fontSize: 12.5,
    color: "var(--accent-text)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,
} as const;
