/* CreateSkillModal — assembles the accepted conventions into an editable
   draft (Name/Description/Type/Enabled/Markdown body), then POSTs it. A name
   conflict with an existing skill surfaces as an explicit "replace?" step,
   never a silent duplicate or a silent overwrite. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SkillType } from "@devdigest/shared";
import { Button, FormField, Modal, SelectInput, TextInput, Textarea, Toggle, Skeleton } from "@devdigest/ui";
import { useConventionSkillDraft, useCreateConventionsSkill } from "@/lib/hooks/conventions";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { SKILL_TYPE_VALUES } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  repoName,
  approvedCount,
  onClose,
}: {
  repoId: string;
  repoName: string;
  approvedCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const toast = useToast();
  const { data: draft, isLoading, isError, error } = useConventionSkillDraft(repoId, true);
  const create = useCreateConventionsSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [conflictSkillId, setConflictSkillId] = React.useState<string | null>(null);
  const seeded = React.useRef(false);

  React.useEffect(() => {
    if (!draft || seeded.current) return;
    seeded.current = true;
    setName(draft.name);
    setDescription(draft.description);
    setType(draft.type);
    setEnabled(draft.enabled);
    setBody(draft.body);
  }, [draft]);

  const submit = (replaceSkillId?: string) => {
    if (!draft) return;
    setConflictSkillId(null);
    create.mutate(
      {
        repoId,
        input: {
          name,
          description,
          type,
          enabled,
          body,
          convention_ids: draft.convention_ids,
          replace_skill_id: replaceSkillId ?? null,
        },
      },
      {
        onSuccess: (skill) => {
          toast.success(t("modal.createdToast", { name: skill.name }));
          onClose();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            const existingId = (err.details as { existing_skill_id?: string } | undefined)
              ?.existing_skill_id;
            setConflictSkillId(existingId ?? null);
            return;
          }
          toast.error(err instanceof ApiError ? err.message : t("modal.createFailed"));
        },
      },
    );
  };

  const typeOptions = SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`modal.type.${v}`) }));
  const disabled = isLoading || create.isPending || !name.trim() || !body.trim();

  return (
    <Modal
      width={720}
      title={t("modal.title")}
      subtitle={repoName}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose} disabled={create.isPending}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={() => submit()} disabled={disabled}>
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      {isLoading && <div style={s.loading}>{t("modal.loadingDraft")}</div>}

      {isError && (
        <div style={s.banner}>
          {error instanceof ApiError ? error.message : t("modal.draftFailed")}
        </div>
      )}

      {draft && (
        <>
          <div style={s.banner}>{t("modal.provenance", { count: approvedCount, repo: repoName })}</div>

          {conflictSkillId && (
            <div style={s.conflict}>
              <span>{t("modal.nameConflict", { name })}</span>
              <div>
                <Button kind="secondary" icon="RefreshCw" onClick={() => submit(conflictSkillId)}>
                  {t("modal.replaceExisting")}
                </Button>
              </div>
            </div>
          )}

          <div style={s.body}>
            <FormField label={t("modal.name")} required>
              <TextInput value={name} onChange={setName} mono />
            </FormField>
            <FormField label={t("modal.description")} required>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label={t("modal.typeLabel")}>
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
            </FormField>
            <div style={s.toggleRow}>
              <span style={s.toggleLabel}>{t("modal.enabled")}</span>
              <Toggle on={enabled} onChange={setEnabled} size={16} />
            </div>
            <FormField label={t("modal.body")} hint={t("modal.bodyHint")} required>
              <Textarea value={body} onChange={setBody} rows={14} mono />
            </FormField>
          </div>
        </>
      )}
    </Modal>
  );
}
