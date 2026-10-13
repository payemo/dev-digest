import type { CiPostAs, CiTarget, CiTrigger } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Wizard steps, in order; labels resolve under `ci.exportWizard.steps`. */
export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;
export const STEP_PREVIEW = 1;
export const STEP_CONFIGURE = 2;
export const STEP_INSTALL = 3;

/** All four targets render; only those with a real generator are selectable. */
export const TARGETS: readonly { key: CiTarget; icon: IconName; enabled: boolean }[] = [
  { key: "gha", icon: "Workflow", enabled: true },
  { key: "circle", icon: "RefreshCw", enabled: false },
  { key: "jenkins", icon: "Settings", enabled: false },
  { key: "cli", icon: "Command", enabled: false },
];

export const TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize", "reopened"];
export const DEFAULT_TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize"];

export const POST_AS_OPTIONS: readonly { value: CiPostAs; labelKey: string; recommended?: boolean }[] = [
  { value: "github_review", labelKey: "exportWizard.postAs.githubReview", recommended: true },
  { value: "pr_comment", labelKey: "exportWizard.postAs.prComment" },
  { value: "none", labelKey: "exportWizard.postAs.none" },
];

export const SECRETS_DOCS_URL =
  "https://docs.github.com/actions/security-guides/using-secrets-in-github-actions";

/** Branch-protection steps shown on the Configure step, under `ci.exportWizard`. */
export const BLOCK_MERGE_STEPS = [
  "exportWizard.blockMergeStep1",
  "exportWizard.blockMergeStep2",
  "exportWizard.blockMergeStep3",
] as const;
