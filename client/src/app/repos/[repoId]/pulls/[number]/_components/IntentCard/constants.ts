import type { ConfidenceBand } from "./helpers";

/**
 * Band → design token. Colours are CSS custom properties, never hex, and never
 * English text: the band's LABEL lives in `messages/en/prReview.json` under
 * `intent.confidence.*`, this map only carries how it is painted.
 */
export const BAND_COLOR: Record<ConfidenceBand, string> = {
  high: "var(--ok)",
  medium: "var(--warn)",
  low: "var(--text-muted)",
};

/** Scope-column icons. `Badge`/`SectionLabel` take an icon NAME, not a glyph. */
export const IN_SCOPE_ICON = "Check" as const;
export const OUT_OF_SCOPE_ICON = "X" as const;
export const RISK_ICON = "AlertTriangle" as const;
