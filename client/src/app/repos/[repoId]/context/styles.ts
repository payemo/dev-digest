import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page. */
export const s = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "24px 28px",
    minHeight: 0,
  } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } satisfies CSSProperties,
  heading: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  repoName: { color: "var(--text-secondary)", marginLeft: 8 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  split: {
    display: "grid",
    gridTemplateColumns: "300px 1fr",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,
  leftCol: { display: "flex", flexDirection: "column", gap: 10, minWidth: 0 } satisfies CSSProperties,
  errorRow: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
} as const;
