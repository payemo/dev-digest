import { VALID_TABS, DEFAULT_TAB, type SkillTab } from "../../constants";

/** Resolve the ?tab= search param against the whitelist, falling back to Config. */
export function resolveTab(param: string | null): SkillTab {
  return (VALID_TABS as readonly string[]).includes(param ?? "") ? (param as SkillTab) : DEFAULT_TAB;
}
