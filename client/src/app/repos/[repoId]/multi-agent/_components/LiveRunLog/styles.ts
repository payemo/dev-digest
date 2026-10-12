import type { CSSProperties } from "react";

/** Co-located styles for LiveRunLog's compact progress-bar variant. */
export const s = {
  bar: { display: "flex", flexDirection: "column", gap: 8, padding: "4px 2px 2px" },
  track: {
    position: "relative",
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    background: "var(--bg-hover)",
  },
  fill: (color: string): CSSProperties => ({
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "40%",
    borderRadius: 2,
    background: color,
    animation: "ddindeterminate 1.4s ease-in-out infinite",
  }),
  latest: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
} satisfies Record<string, CSSProperties | ((...args: never[]) => CSSProperties)>;
