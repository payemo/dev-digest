import type { CSSProperties } from "react";

export const s = {
  accept: { display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  acceptPct: (color: string | null): CSSProperties => ({
    fontWeight: 600,
    color: color ?? "var(--text-secondary)",
  }),
  n: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
