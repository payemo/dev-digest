import type { CSSProperties } from "react";

export const s = {
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
    margin: "0 24px 16px",
  } satisfies CSSProperties,
  conflict: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13,
    lineHeight: 1.5,
    margin: "0 24px 16px",
  } satisfies CSSProperties,
  body: { padding: "0 24px 4px" } satisfies CSSProperties,
  toggleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 } satisfies CSSProperties,
  toggleLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  loading: { padding: "40px 24px", textAlign: "center", color: "var(--text-muted)" } satisfies CSSProperties,
};
