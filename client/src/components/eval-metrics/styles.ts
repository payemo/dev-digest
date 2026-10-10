import type { CSSProperties } from "react";

/** Metric colours shared by every eval surface (tiles, bars, trend). */
export const METRIC_COLOR = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

export const s = {
  tiles: { display: "flex", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  tile: { flex: "1 1 150px", minWidth: 150, display: "flex" } satisfies CSSProperties,
  empty: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 9,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  progress: { display: "flex", flexDirection: "column", gap: 8, minWidth: 220 } satisfies CSSProperties,
  progressRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  progressCount: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  icons: { display: "flex", flexWrap: "wrap", gap: 4 } satisfies CSSProperties,
  failed: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  bar: { display: "flex", alignItems: "center", gap: 8, minWidth: 110 } satisfies CSSProperties,
  barTrack: { flex: 1 } satisfies CSSProperties,
  barLabel: { fontSize: 12, color: "var(--text-secondary)", width: 34, textAlign: "right" } satisfies CSSProperties,
} as const;
