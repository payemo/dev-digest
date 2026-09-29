import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "8px 10px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: 99,
    background: color,
    flex: "0 0 auto",
  }),
  line: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  reason: { fontSize: 12, color: "var(--text-muted)", width: "100%" } satisfies CSSProperties,
} as const;
