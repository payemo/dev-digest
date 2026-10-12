import type { CSSProperties } from "react";

/** Co-located styles for ColumnsView. */
export const s = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
    alignItems: "start",
  },
} satisfies Record<string, CSSProperties>;
