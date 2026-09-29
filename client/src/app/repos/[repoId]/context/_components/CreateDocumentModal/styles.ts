import type { CSSProperties } from "react";

export const s = {
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,
  uploadLabel: {
    fontSize: 12,
    color: "var(--accent)",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  } satisfies CSSProperties,
  pathPreview: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  error: { fontSize: 12, color: "var(--crit)", margin: "8px 0 0" } satisfies CSSProperties,
} as const;
