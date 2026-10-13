import type { CSSProperties } from "react";

export const s = {
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: "10px 20px",
    margin: 0,
  } satisfies CSSProperties,
  dt: { fontSize: 11.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" } satisfies CSSProperties,
  dd: { margin: 0, fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
} as const;
