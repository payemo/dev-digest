import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "14px 18px",
    minWidth: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  path: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  headerRight: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  notice: { fontSize: 12, color: "var(--crit)", margin: 0 } satisfies CSSProperties,
  readOnly: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  body: {
    borderTop: "1px solid var(--border)",
    paddingTop: 12,
    fontSize: 14,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
} as const;
