import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column", padding: 24 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
