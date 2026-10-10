import type { CSSProperties } from "react";
import type { DiffLine } from "@/lib/line-diff";

const LINE: Record<DiffLine["kind"], CSSProperties> = {
  add: { background: "var(--ok-bg)", color: "var(--text-primary)" },
  del: { background: "var(--crit-bg)", color: "var(--text-primary)", textDecoration: "line-through" },
  context: { color: "var(--text-secondary)" },
};

export const s = {
  body: { padding: "18px 24px", display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  cards: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 } satisfies CSSProperties,
  card: { padding: "12px 14px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-surface)" } satisfies CSSProperties,
  cardLabel: { fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", color: "var(--text-muted)" } satisfies CSSProperties,
  cardValues: { display: "flex", alignItems: "baseline", gap: 6, marginTop: 8, flexWrap: "wrap" } satisfies CSSProperties,
  from: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
  to: { fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  delta: (dir: "up" | "down" | "flat"): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color: dir === "up" ? "var(--ok)" : dir === "down" ? "var(--crit)" : "var(--text-muted)",
  }),
  legend: { display: "flex", gap: 14, fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  swatch: (kind: "add" | "del"): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: 3,
    display: "inline-block",
    background: kind === "add" ? "var(--ok-bg)" : "var(--crit-bg)",
    border: `1px solid ${kind === "add" ? "var(--ok)" : "var(--crit)"}`,
  }),
  diff: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--code-bg)",
    border: "1px solid var(--border)",
    fontSize: 12.5,
    lineHeight: 1.6,
    maxHeight: 280,
    overflow: "auto",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  diffLine: (kind: DiffLine["kind"]): CSSProperties => ({ display: "block", padding: "0 4px", ...LINE[kind] }),
  list: { margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  footerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  confirmText: { flex: 1, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  warning: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    padding: "9px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
