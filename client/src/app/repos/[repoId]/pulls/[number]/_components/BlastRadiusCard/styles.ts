import type { CSSProperties } from "react";

/**
 * Presentation for BlastRadiusCard (loading and degraded rows). Colours are design tokens, never hex.
 * Entries that depend on a prop are functions of it rather than inline objects
 * at the call site, so the component file stays about structure.
 */
export const s = {
  loading: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  degradedRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
} as const;
