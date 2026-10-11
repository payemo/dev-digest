import type { CSSProperties } from "react";
import { GRID } from "../../constants";

export const s = {
  row: {
    display: "grid",
    gridTemplateColumns: GRID,
    gap: 12,
    alignItems: "center",
    padding: "11px 16px",
    fontSize: 13,
    borderBottom: "1px solid var(--border)",
    minWidth: 1100,
  } satisfies CSSProperties,
  muted: { color: "var(--text-muted)", fontSize: 12.5 } satisfies CSSProperties,
  cell: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  link: { color: "var(--accent-text)", textDecoration: "none" } satisfies CSSProperties,
  status: { display: "flex", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  jobLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "var(--text-secondary)",
    textDecoration: "none",
    fontSize: 12.5,
  } satisfies CSSProperties,
} as const;
