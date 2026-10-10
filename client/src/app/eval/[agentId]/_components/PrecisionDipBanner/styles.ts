import type { CSSProperties } from "react";

export const s = {
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 13.5,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  icon: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,
} as const;
