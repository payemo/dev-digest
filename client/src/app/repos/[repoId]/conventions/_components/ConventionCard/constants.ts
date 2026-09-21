import type { ConventionCandidate } from "@devdigest/shared";

/** Category options for the inline-edit select, in a stable display order. */
export const CATEGORY_ORDER: ConventionCandidate["category"][] = [
  "naming",
  "structure",
  "errors",
  "testing",
  "imports",
  "typing",
  "api",
  "general",
];
