import type { CSSProperties } from "react";

export const s = {
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  body: { padding: "18px 24px", fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 } satisfies CSSProperties,
  error: { padding: "0 24px 18px", fontSize: 13, color: "var(--crit)", margin: 0 } satisfies CSSProperties,
} as const;
