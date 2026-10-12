import type { CSSProperties } from "react";

export const s = {
  steps: { padding: "16px 24px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
} as const;
