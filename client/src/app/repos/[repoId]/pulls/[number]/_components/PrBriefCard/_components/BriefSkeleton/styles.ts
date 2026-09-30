import type { CSSProperties } from "react";

/** Presentation for BriefSkeleton — mirrors PrBriefCard's layout. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  column: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 16,
  } satisfies CSSProperties,
} as const;
