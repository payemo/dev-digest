import type { CiFailOn } from "@devdigest/shared";

/** The segmented control's options, in display order. `any` is Config-only. */
export const FAIL_ON_OPTIONS: readonly { value: Exclude<CiFailOn, "any">; labelKey: string }[] = [
  { value: "critical", labelKey: "ciTab.failOn.critical" },
  { value: "warning", labelKey: "ciTab.failOn.warning" },
  { value: "never", labelKey: "ciTab.failOn.never" },
];
