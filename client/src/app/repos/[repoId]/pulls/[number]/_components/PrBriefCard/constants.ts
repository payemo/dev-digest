import type { IconName } from "@devdigest/ui";
import type { BriefInputs, RiskSeverity } from "@devdigest/shared";

/**
 * Risk severity → how it is painted. Colours are CSS custom properties, never
 * hex; the severity LABEL lives in `messages/en/brief.json` (`severity.*`).
 */
export const SEVERITY_META: Record<RiskSeverity, { color: string; icon: IconName }> = {
  high: { color: "var(--crit)", icon: "Shield" },
  medium: { color: "var(--warn)", icon: "AlertTriangle" },
  low: { color: "var(--text-muted)", icon: "Info" },
};

/** The order inputs are named in the "Generated without" line. */
export const INPUT_ORDER: (keyof BriefInputs)[] = [
  "intent",
  "blast",
  "description",
  "linked_issue",
  "project_context",
];

/** Input key → its `brief.json` label key. */
export const INPUT_LABEL_KEY: Record<keyof BriefInputs, string> = {
  intent: "input.intent",
  blast: "input.blast",
  description: "input.description",
  linked_issue: "input.linked_issue",
  project_context: "input.project_context",
};

/** A link-blue for file refs — `--accent-text`, not `--info` (which is grey). */
export const REF_COLOR = "var(--accent-text)";
