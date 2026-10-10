import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  right: { marginLeft: "auto" } satisfies CSSProperties,
  forbidden: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 } satisfies CSSProperties,
  forbiddenRow: { display: "flex", gap: 8 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
