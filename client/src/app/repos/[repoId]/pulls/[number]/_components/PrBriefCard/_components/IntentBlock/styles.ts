import type { CSSProperties } from "react";

/** Presentation for IntentBlock. Colours are design tokens, never hex. */
export const s = {
  /** Plain text in quotes — deliberately NOT Markdown. */
  sentence: {
    fontSize: 14.5,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    fontStyle: "italic",
    fontWeight: 500,
  } satisfies CSSProperties,
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 18,
    marginTop: 14,
  } satisfies CSSProperties,
  scopeHeading: (kind: "in" | "out"): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: kind === "in" ? "var(--ok)" : "var(--text-muted)",
    marginBottom: 8,
  }),
  scopeList: {
    margin: 0,
    paddingLeft: 14,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
