import type { CSSProperties } from "react";

export const s = {
  card: { padding: 18, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)" } satisfies CSSProperties,
  chart: { width: "100%", height: 220 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "24px 0" } satisfies CSSProperties,
  legend: { display: "flex", gap: 14, fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  swatch: (color: string): CSSProperties => ({ width: 10, height: 2, background: color, display: "inline-block" }),
} as const;
