import type { SkillType } from "@devdigest/shared";

/** Badge tint per skill type — reuses the CSS severity/category vars where a
 *  natural mapping exists, falls back to the neutral text-secondary token. */
const TYPE_COLOR: Record<SkillType, string> = {
  security: "var(--crit)",
  rubric: "var(--accent)",
  convention: "var(--ok)",
  custom: "var(--text-secondary)",
};

export function typeColor(type: SkillType): string {
  return TYPE_COLOR[type] ?? "var(--text-secondary)";
}
