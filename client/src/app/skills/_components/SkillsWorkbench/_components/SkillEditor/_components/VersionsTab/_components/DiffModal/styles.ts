import type { CSSProperties } from "react";
import type { DiffLine } from "./helpers";

export const s = {
  wrap: {
    padding: "8px 0",
    background: "var(--code-bg)",
  } satisfies CSSProperties,
  empty: {
    padding: "24px",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  row: (kind: DiffLine["kind"]): CSSProperties => ({
    display: "flex",
    gap: 10,
    padding: "0 16px",
    background: kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent",
  }),
  sign: (kind: DiffLine["kind"]): CSSProperties => ({
    flexShrink: 0,
    width: 12,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
  }),
  text: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 12.5,
    lineHeight: 1.6,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
