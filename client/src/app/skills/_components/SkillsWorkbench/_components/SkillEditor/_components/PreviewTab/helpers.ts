import type { Skill } from "@devdigest/shared";

/**
 * Mirror of the server's `renderSkillBlock`
 * (server/src/modules/reviews/helpers.ts) — same heading + description +
 * body shape, so this tab shows EXACTLY what an enabled, linked copy of this
 * skill looks like inside `## Skills / rules`. Keep the two in sync.
 */
export function renderSkillBlockPreview(skill: Pick<Skill, "name" | "description" | "body">): string {
  const heading = `### ${skill.name}`;
  const intro = skill.description.trim() ? `_${skill.description.trim()}_\n\n` : "";
  return `${heading}\n${intro}${skill.body.trim()}`;
}
