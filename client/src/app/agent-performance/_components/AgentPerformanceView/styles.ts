import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  kpiSkeletons: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 } satisfies CSSProperties,
  provenance: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 } satisfies CSSProperties,
  updating: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footnote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
