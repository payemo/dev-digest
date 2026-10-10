import type { CSSProperties } from "react";

export const s = {
  banner: (positive: boolean): CSSProperties => ({
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.45,
    border: `1px solid ${positive ? "var(--accent)" : "var(--border-strong)"}`,
    background: positive ? "var(--accent-bg)" : "var(--bg-surface)",
    color: "var(--text-primary)",
  }),
  icon: (positive: boolean): CSSProperties => ({
    flexShrink: 0,
    marginTop: 2,
    color: positive ? "var(--accent)" : "var(--text-muted)",
  }),
  kind: (positive: boolean): CSSProperties => ({
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: positive ? "var(--accent-text)" : "var(--text-primary)",
  }),
} as const;
