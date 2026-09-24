import type { CSSProperties } from "react";

export const s = {
  /** The derived sentence. Plain text in quotes — deliberately NOT Markdown. */
  sentence: {
    fontSize: 14.5,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 18,
    marginTop: 16,
  } satisfies CSSProperties,
  scopeHeading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  scopeList: {
    margin: 0,
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  } satisfies CSSProperties,
  hint: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
    marginTop: 14,
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 18,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footerRight: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  loading: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
} as const;
