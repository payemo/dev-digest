/* CreateDocumentModal — write a document here, or upload a Markdown file and
   post its text. Both are the same intake; upload is not a second code path.

   The "new folder" affordance is the free-text folder field: a folder comes
   into existence by holding a document, so there is no empty folder to create
   and nothing to persist separately. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { ContextDocumentCategory } from "@/lib/types";
import { useCreateContextDocument } from "@/lib/hooks/project-context";
import { ApiError } from "@/lib/api";
import { CATEGORY_ORDER, MAX_DOC_BYTES } from "../../constants";
import { byteLength, precheckIntake } from "../../helpers";
import { s } from "./styles";

export function CreateDocumentModal({
  repoId,
  onClose,
}: {
  repoId: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const create = useCreateContextDocument();

  const [category, setCategory] = React.useState<ContextDocumentCategory>("specs");
  const [folder, setFolder] = React.useState("");
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const path = `.devdigest/${category}/${folder ? `${folder}/` : ""}${name || "…"}`;

  const readFile = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onerror = () => setError(t("createModal.reject.readFailed"));
    reader.onload = () => {
      setBody(typeof reader.result === "string" ? reader.result : "");
      if (name.trim().length === 0) setName(file.name);
    };
    reader.readAsText(file);
  };

  const submit = () => {
    // A pre-check so an obvious rejection is explained here rather than
    // arriving as a 422 — the server's own validation still decides.
    const rejected = precheckIntake(name, body);
    if (rejected) {
      setError(
        rejected === "tooLarge"
          ? t("createModal.reject.tooLarge", { size: byteLength(body), max: MAX_DOC_BYTES })
          : t(`createModal.reject.${rejected}`),
      );
      return;
    }
    setError(null);
    create.mutate(
      { repoId, intake: { category, folder, name: name.trim(), body } },
      {
        onSuccess: onClose,
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : t("createModal.reject.readFailed")),
      },
    );
  };

  return (
    <Modal
      width={640}
      title={t("createModal.title")}
      subtitle={t("createModal.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("createModal.cancel")}
          </Button>
          <Button kind="primary" onClick={submit} loading={create.isPending}>
            {create.isPending ? t("createModal.submitting") : t("createModal.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("createModal.categoryLabel")} required>
          <SelectInput
            value={category}
            onChange={(v) => setCategory(v as ContextDocumentCategory)}
            options={CATEGORY_ORDER.map((c) => ({ value: c, label: t(`category.${c}`) }))}
          />
        </FormField>

        <FormField label={t("createModal.folderLabel")} hint={t("createModal.folderHint")}>
          <TextInput
            value={folder}
            onChange={setFolder}
            placeholder={t("createModal.folderPlaceholder")}
            mono
          />
        </FormField>

        <FormField label={t("createModal.nameLabel")} required>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={t("createModal.namePlaceholder")}
            mono
          />
        </FormField>

        <FormField
          label={t("createModal.bodyLabel")}
          required
          right={
            <label style={s.uploadLabel}>
              {t("createModal.upload")}
              <input
                type="file"
                accept=".md,.markdown,text/markdown"
                style={s.fileInput}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readFile(file);
                }}
              />
            </label>
          }
        >
          <Textarea
            value={body}
            onChange={setBody}
            placeholder={t("createModal.bodyPlaceholder")}
            rows={10}
            mono
          />
        </FormField>

        <p className="mono" style={s.pathPreview}>
          {t("createModal.pathPreview", { path })}
        </p>
        {error && (
          <p style={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
