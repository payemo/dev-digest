import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 760, padding: 24, display: "flex", flexDirection: "column", gap: 24 } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 14 } satisfies CSSProperties,
  metricCol: { flex: 1, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  metricCaption: { fontSize: 11, color: "var(--text-muted)", paddingLeft: 4 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 600, marginBottom: 8 } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45, marginTop: 8 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "12px 0" } satisfies CSSProperties,
} as const;
