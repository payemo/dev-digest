import type { CSSProperties } from "react";
import { DROPDOWN_WIDTH } from "./constants";

/** Co-located styles for RunReviewDropdown (trigger wrapper + popover shell). */
export const s = {
  root: { position: "relative", display: "inline-block" },
  trigger: (warnMerged: boolean): CSSProperties => (warnMerged ? { opacity: 0.6 } : {}),
  popover: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    width: DROPDOWN_WIDTH,
    zIndex: 50,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "var(--shadow-modal)",
    padding: 6,
  },
} satisfies Record<string, CSSProperties | ((...args: never[]) => CSSProperties)>;
