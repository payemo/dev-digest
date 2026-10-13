import type { CSSProperties } from "react";

export const s = {
  actions: (marginTop = 14): CSSProperties => ({
    display: "flex",
    gap: 8,
    marginTop,
    flexWrap: "wrap",
  }),
} as const;
