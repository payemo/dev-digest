import type { CSSProperties } from "react";

/** Co-located styles for DiffTab. Colours are tokens, never hex. */
export const s = {
  /** The order control and the visibility toggle share SectionLabel's right slot. */
  controls: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  orderGroup: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  /** `Chip` takes no `disabled` prop and must not be rebuilt — the group is
   *  made inert here instead, while `/smart-diff` is loading or has failed. */
  orderGroupInert: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    opacity: 0.5,
    pointerEvents: "none",
  } satisfies CSSProperties,
  summary: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: -8,
    marginBottom: 12,
  } satisfies CSSProperties,
  degraded: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 10,
  } satisfies CSSProperties,
  /** FR-19 — the deep-link target is not a file in this diff. */
  notInDiff: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    padding: "8px 12px",
    marginBottom: 10,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
