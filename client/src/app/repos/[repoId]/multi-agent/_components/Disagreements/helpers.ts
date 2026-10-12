/* Disagreements helpers — pure, no React. */
import type { DisagreementRow } from "@devdigest/shared";

/** Rows to show: every grouped location, or only the conflicts. */
export function visibleRows(rows: DisagreementRow[], onlyConflicts: boolean): DisagreementRow[] {
  return onlyConflicts ? rows.filter((r) => r.conflict) : rows;
}
