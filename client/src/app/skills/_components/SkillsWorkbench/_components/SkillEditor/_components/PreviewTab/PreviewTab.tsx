/* PreviewTab — renders the skill exactly as it appears in the assembled
   prompt's "## Skills / rules" section (see reviewer-core/src/prompt.ts). */
"use client";

import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { renderSkillBlockPreview } from "./helpers";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <p style={s.note}>{t("editor.preview.body")}</p>
      {!skill.enabled && <div style={s.disabledNote}>{t("editor.preview.disabledNote")}</div>}
      <div style={s.card}>
        <Markdown>{renderSkillBlockPreview(skill)}</Markdown>
      </div>
    </div>
  );
}
