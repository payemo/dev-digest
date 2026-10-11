import type { CSSProperties } from "react";

/** Co-located styles for ResultsHeader. */
export const s = {
  root: {
    padding: "18px 32px 14px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  row: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  title: { fontSize: 20, fontWeight: 700, color: "var(--text-primary)" },
  sub: { fontSize: 12.5, color: "var(--text-muted)" },
  spacer: { flex: 1 },
  modes: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
    gap: 2,
  },
  pr: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 },
  prNumber: { color: "var(--text-muted)" },
  prTitle: { fontWeight: 600, color: "var(--text-primary)" },
  totals: { fontSize: 12.5, color: "var(--text-secondary)", display: "flex", gap: 10, alignItems: "center" },
  failed: { color: "var(--failed)" },
} satisfies Record<string, CSSProperties>;
