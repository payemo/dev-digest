import type { CSSProperties } from "react";

/** Co-located styles for AgentCard. Identity colours arrive as CSS tokens. */
export const s = {
  card: (checked: boolean, color: string, bg: string): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: `1px solid ${checked ? color : "var(--border)"}`,
    background: checked ? bg : "var(--bg-surface)",
    cursor: "pointer",
  }),
  icon: (color: string, bg: string): CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 7,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 },
  name: { fontWeight: 600, fontSize: 14, color: "var(--text-primary)" },
  description: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  estimate: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
    flexShrink: 0,
  },
} satisfies Record<string, CSSProperties | ((...args: never[]) => CSSProperties)>;
