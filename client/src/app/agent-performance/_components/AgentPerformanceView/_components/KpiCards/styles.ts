import type { CSSProperties } from "react";

export const s = {
  row: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 } satisfies CSSProperties,
  col: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } satisfies CSSProperties,
  caption: { fontSize: 11.5, color: "var(--text-muted)", paddingLeft: 4 } satisfies CSSProperties,
  delta: (color: string): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color,
    paddingLeft: 4,
  }),
  costValue: { display: "inline-flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  ringValue: { display: "inline-flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  agentName: {
    display: "block",
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
} as const;
