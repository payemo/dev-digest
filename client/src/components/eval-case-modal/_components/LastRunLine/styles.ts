import type { CSSProperties } from "react";
import type { EvalCaseStatus } from "@devdigest/shared";

const TONE: Record<EvalCaseStatus, { fg: string; bg: string }> = {
  passed: { fg: "var(--ok)", bg: "var(--ok-bg)" },
  failed: { fg: "var(--crit)", bg: "var(--crit-bg)" },
  errored: { fg: "var(--warn)", bg: "var(--warn-bg)" },
};

export const s = {
  line: (status: EvalCaseStatus): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    color: "var(--text-primary)",
    background: TONE[status].bg,
    border: `1px solid ${TONE[status].fg}`,
  }),
  icon: (status: EvalCaseStatus): CSSProperties => ({ flexShrink: 0, color: TONE[status].fg }),
} as const;
