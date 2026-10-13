import type { CSSProperties } from "react";

export const s = {
  selector: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  periodSelect: { minWidth: 140 } satisfies CSSProperties,
  dateLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  invalid: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  arrow: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    color,
    verticalAlign: "middle",
  }),
  noArrow: {
    display: "inline-block",
    minWidth: 12,
    textAlign: "center",
    color: "var(--text-muted)",
    cursor: "help",
  } satisfies CSSProperties,
} as const;
