import type { CSSProperties } from "react";

/** Co-located styles for the Conventions page. */
export const s = {
  page: { display: "flex", flexDirection: "column", gap: 20, padding: "24px 28px" } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } satisfies CSSProperties,
  heading: { fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 } satisfies CSSProperties,
  repoName: { color: "var(--text-secondary)" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  filters: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  cardList: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  skeletonCard: { display: "flex", flexDirection: "column", gap: 10, padding: 4 } satisfies CSSProperties,
  noValidWrap: { padding: "12px 0" } satisfies CSSProperties,
};
