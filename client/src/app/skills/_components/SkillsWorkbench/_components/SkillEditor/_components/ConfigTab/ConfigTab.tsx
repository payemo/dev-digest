/* ConfigTab — name/description/type/body + enabled toggle. Body edits create
   a new version (skill_versions); everything else does not (see
   modules/skills/helpers.ts's isBodyChange). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Button } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../../lib/toast";
import { SKILL_TYPE_VALUES } from "./constants";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);

  // Reset local form when switching skills.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const needsVetting = skill.source !== "manual" && !skill.enabled;

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body, enabled } },
      {
        onSuccess: (data) => toast.success(t("editor.config.savedToast", { name: data.name, version: data.version })),
      },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("editor.config.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>
      {needsVetting && <div style={s.vettingNote}>{t("editor.config.vettingHint")}</div>}
      <FormField label={t("editor.config.name")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("editor.config.description")} hint={t("editor.config.descriptionHint")} required>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("editor.config.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField label={t("editor.config.source")} hint={t("editor.config.sourceHint")}>
        <SelectInput value={skill.source} options={[skill.source]} />
      </FormField>
      <FormField label={t("editor.config.body")} hint={t("editor.config.bodyHint")} required>
        <Textarea value={body} onChange={setBody} rows={10} mono />
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("editor.config.saving") : t("editor.config.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote} role="status" aria-live="polite">
            {t("editor.config.saved", { version: update.data?.version })}
          </span>
        )}
      </div>
    </div>
  );
}
