import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 760, padding: 24 } satisfies CSSProperties,
  note: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 16,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  disabledNote: {
    fontSize: 13,
    color: "var(--text-muted)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    marginBottom: 16,
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 20,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
