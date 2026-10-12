import type { CSSProperties } from "react";

/** Co-located styles for ConfigureRun. */
export const s = {
  root: {
    padding: "36px 32px 48px",
    maxWidth: 720,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  h1: { fontSize: 22, fontWeight: 700, color: "var(--text-primary)" },
  subtitle: { fontSize: 13.5, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 },
  step: { display: "flex", flexDirection: "column", gap: 10 },
  stepHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  stepTitle: { display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 14 },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontSize: 11.5,
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
  },
  selectWrap: { maxWidth: 420 },
  selectAll: {
    border: "none",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 12.5,
    cursor: "pointer",
    padding: 0,
  },
  cards: { display: "flex", flexDirection: "column", gap: 8 },
  muted: { fontSize: 13, color: "var(--text-muted)", padding: "12px 0" },
  footer: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  total: { fontSize: 12.5, color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)" },
  partial: { color: "var(--warn)", marginLeft: 6 },
} satisfies Record<string, CSSProperties>;
