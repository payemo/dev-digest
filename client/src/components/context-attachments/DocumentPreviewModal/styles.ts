import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10, padding: 20 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  path: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  readOnly: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  body: {
    borderTop: "1px solid var(--border)",
    paddingTop: 12,
    fontSize: 14,
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
} as const;
