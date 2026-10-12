import type { CSSProperties } from "react";

/** Co-located styles for TabsView. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 14 },
  body: { display: "flex", flexDirection: "column", gap: 10, maxWidth: 820 },
  summary: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${color}`,
    borderRadius: 8,
    background: "var(--bg-surface)",
  }),
  summaryMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 },
  summaryName: (color: string): CSSProperties => ({ fontWeight: 600, fontSize: 14, color }),
  summaryText: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, whiteSpace: "pre-wrap" },
  summarySide: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 },
  meta: { fontSize: 11.5, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" },
  error: { fontSize: 13, color: "var(--failed)", wordBreak: "break-word" },
  muted: { fontSize: 13, color: "var(--text-muted)", padding: "8px 2px" },
} satisfies Record<string, CSSProperties | ((...args: never[]) => CSSProperties)>;
