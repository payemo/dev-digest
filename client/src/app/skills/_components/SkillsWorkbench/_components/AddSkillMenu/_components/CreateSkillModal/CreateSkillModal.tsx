/* CreateSkillModal — name/description/type/body. A hand-authored skill (the
   only source that may start enabled — see modules/skills/service.ts). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../../../lib/hooks/skills";
import { MODAL_WIDTH, SKILL_TYPE_VALUES } from "../../constants";
import { s } from "./styles";

export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || "Untitled skill",
      description,
      type,
      body: body.trim() || "_Add the rule this skill enforces._",
      source: "manual",
      enabled: true,
    });
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("editor.header.create")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("editor.config.saving") : t("page.addSkill")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("editor.config.name")} required>
          <TextInput value={name} onChange={setName} placeholder="pr-quality-rubric" />
        </FormField>
        <FormField label={t("editor.config.description")} hint={t("editor.config.descriptionHint")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>
        <FormField label={t("editor.config.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
        </FormField>
        <FormField label={t("editor.config.body")} hint={t("editor.config.bodyHint")}>
          <Textarea value={body} onChange={setBody} rows={6} mono />
        </FormField>
      </div>
    </Modal>
  );
}
