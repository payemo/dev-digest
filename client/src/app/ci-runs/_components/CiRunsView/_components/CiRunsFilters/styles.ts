import type { CSSProperties } from "react";

export const s = {
  bar: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(160px, 220px))",
    gap: 10,
    marginBottom: 16,
  } satisfies CSSProperties,
} as const;
