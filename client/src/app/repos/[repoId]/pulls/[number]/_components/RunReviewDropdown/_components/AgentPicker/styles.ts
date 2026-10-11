import type { CSSProperties } from "react";

/** Co-located styles for AgentPicker. */
export const s = {
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 8px 8px",
  },
  heading: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  },
  clear: {
    border: "none",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 12.5,
    cursor: "pointer",
    padding: 0,
  },
  list: { display: "flex", flexDirection: "column", gap: 2, padding: "0 4px 6px" },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "6px 4px",
  },
  name: { color: "var(--text-primary)", fontSize: 13.5 },
  estimate: { fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)", flexShrink: 0 },
  muted: { fontSize: 12.5, color: "var(--text-secondary)", padding: "6px 8px" },
  warn: { fontSize: 12, color: "var(--warn)", padding: "4px 8px 8px" },
  divider: { height: 1, background: "var(--border)", margin: "4px 0" },
  actions: { display: "flex", flexDirection: "column", gap: 6, padding: "6px 4px" },
  link: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 13,
    textAlign: "left",
    padding: "8px 8px",
    borderRadius: 6,
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;
