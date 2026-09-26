import type { SmartDiffRole } from "@devdigest/shared";

/**
 * Presentation-only lookups for the Smart Diff groups. The server's
 * `constants.ts` owns the classification patterns and the response order;
 * these three maps own how a role LOOKS, which is a client concern.
 */

/** i18n KEYS, never English text — the copy lives in messages/en/prReview.json. */
export const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreLabel",
  tests: "smartDiff.testsLabel",
  wiring: "smartDiff.wiringLabel",
  docs: "smartDiff.docsLabel",
  boilerplate: "smartDiff.boilerplateLabel",
};

export const ROLE_DESC_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreDesc",
  tests: "smartDiff.testsDesc",
  wiring: "smartDiff.wiringDesc",
  docs: "smartDiff.docsDesc",
  boilerplate: "smartDiff.boilerplateDesc",
};

/**
 * CSS custom properties, never hex. `docs` deliberately avoids `--info` and
 * `--stale`: both resolve to the same grey in dark mode, which would make the
 * two adjacent grey groups indistinguishable.
 */
export const ROLE_SWATCH: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  tests: "var(--ok)",
  wiring: "var(--warn)",
  docs: "var(--text-secondary)",
  boilerplate: "var(--info)",
};

/** Collapsed on open — at the GROUP level, not per file. */
export const DEFAULT_COLLAPSED_ROLES = ["docs", "boilerplate"] as const;
