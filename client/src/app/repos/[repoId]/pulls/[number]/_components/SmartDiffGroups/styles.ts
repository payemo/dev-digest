import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffGroups. Colours are tokens, never hex. */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "7px 2px",
    cursor: "pointer",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  swatch: (color: string): CSSProperties => ({
    width: 9,
    height: 9,
    borderRadius: 2,
    flexShrink: 0,
    background: color,
  }),
  roleName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  roleDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  findingCount: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  /** Presence indicator on the group header — same semantic as the file dot. */
  findingDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--crit)",
  } satisfies CSSProperties,
  fileCount: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  noReview: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the group is open (matches the file cards). */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
