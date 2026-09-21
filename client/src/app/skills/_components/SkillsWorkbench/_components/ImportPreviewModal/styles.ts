import type { CSSProperties } from "react";

export const s = {
  drop: (dragging: boolean): CSSProperties => ({
    border: "1px dashed " + (dragging ? "var(--accent)" : "var(--border-strong)"),
    borderRadius: 8,
    padding: "28px 16px",
    textAlign: "center",
    color: "var(--text-secondary)",
    fontSize: 13,
    cursor: "pointer",
    background: dragging ? "var(--accent-bg)" : "var(--bg-elevated)",
  }),
  list: { display: "flex", flexDirection: "column", gap: 8, marginTop: 16, maxHeight: 320, overflow: "auto" } satisfies CSSProperties,
  entry: (kept: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: kept ? "var(--bg-elevated)" : "var(--bg-hover)",
    opacity: kept ? 1 : 0.75,
  }),
  entryPath: { fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  entryNote: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", marginTop: 10 } satisfies CSSProperties,
  vettingNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 14,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
