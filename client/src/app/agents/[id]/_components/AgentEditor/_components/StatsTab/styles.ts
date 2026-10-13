import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 900, display: "flex", flexDirection: "column", gap: 22 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 600 } satisfies CSSProperties,
  updating: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  metricsRow: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "6px 14px" } satisfies CSSProperties,
  // Each column spans the card row + caption row of the parent grid (subgrid), so every
  // card has the same height whether or not its column has a caption.
  metricCol: { display: "grid", gridRow: "span 2", gridTemplateRows: "subgrid", rowGap: 6, minWidth: 0 } satisfies CSSProperties,
  metricCaption: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    fontSize: 11.5,
    color: "var(--text-muted)",
    paddingLeft: 18, // MetricCard's inner padding, so the caption lines up with the label/value
  } satisfies CSSProperties,
  costValue: { display: "inline-flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 600, marginBottom: 8 } satisfies CSSProperties,
  facts: { display: "flex", gap: 24, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 } satisfies CSSProperties,
} as const;
