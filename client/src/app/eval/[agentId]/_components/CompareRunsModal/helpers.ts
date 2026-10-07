/* Pure helpers for the Compare runs modal. */
import type { EvalCompare } from "@devdigest/shared";

/** The version Promote targets (the newer run's), and whether it can be promoted. */
export function promoteTarget(c: EvalCompare): { version: number; available: boolean; skillMismatch: boolean } {
  return { version: c.promote.version, available: c.promote.available, skillMismatch: c.promote.skill_mismatch };
}

/** One config-difference line: an i18n key under `eval.compare` + its values. */
export interface ConfigLine {
  key: string;
  values?: Record<string, string | number>;
}

/** The config differences between the two runs, in display order. */
export function configLines(c: EvalCompare): ConfigLine[] {
  if (c.no_config_change && c.case_set.same) return [{ key: "compare.noConfigChange" }];
  const lines: ConfigLine[] = [];
  if (c.no_config_change) lines.push({ key: "compare.noConfigChange" });
  if (c.model_change) lines.push({ key: "compare.modelChanged", values: { from: c.model_change.from, to: c.model_change.to } });
  if (c.skill_diff.added.length > 0) lines.push({ key: "compare.skillsAdded", values: { names: c.skill_diff.added.join(", ") } });
  if (c.skill_diff.removed.length > 0) lines.push({ key: "compare.skillsRemoved", values: { names: c.skill_diff.removed.join(", ") } });
  if (c.skill_diff.reordered) lines.push({ key: "compare.skillsReordered" });
  for (const ch of c.skill_diff.changed) {
    lines.push({ key: "compare.skillChanged", values: { name: ch.name, from: ch.from_version, to: ch.to_version } });
  }
  if (!c.case_set.same) {
    lines.push({ key: "compare.caseSetDiffers", values: { onlyOld: c.case_set.only_old, onlyNew: c.case_set.only_new } });
  }
  return lines;
}
