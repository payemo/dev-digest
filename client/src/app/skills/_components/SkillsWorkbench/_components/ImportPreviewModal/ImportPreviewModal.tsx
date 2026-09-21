/* ImportPreviewModal — parses a markdown file or a .zip archive ENTIRELY in
   the browser, shows every entry it found (kept + dropped, with why), and
   only on confirm POSTs plain JSON per kept entry with source:'community'.
   No file ever reaches the server; the server itself has no multipart/unzip
   handling (see server/CLAUDE.md — that's deliberate, not a gap). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Badge, Icon } from "@devdigest/ui";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { MAX_IMPORT_BYTES } from "./constants";
import { parseArchive, parseMarkdownSkill, type ImportEntry } from "./helpers";
import { s } from "./styles";

const REASON_KEY: Record<NonNullable<ImportEntry["reason"]>, string> = {
  extension: "import.entryDroppedExt",
  "unsafe-path": "import.entryDroppedPath",
  "too-many-entries": "import.tooManyEntries",
  empty: "import.entryDroppedExt",
};

export function ImportPreviewModal({
  kind,
  onClose,
}: {
  kind: "file" | "archive";
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const create = useCreateSkill();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [entries, setEntries] = React.useState<ImportEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  async function handleFile(file: File) {
    setError(null);
    setEntries(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setError(t("import.tooLarge", { maxMb: Math.round(MAX_IMPORT_BYTES / (1024 * 1024)) }));
      return;
    }
    try {
      if (kind === "archive") {
        const bytes = new Uint8Array(await file.arrayBuffer());
        setEntries(parseArchive(bytes));
      } else {
        const text = await file.text();
        const isMd = /\.(md|markdown)$/i.test(file.name);
        setEntries(
          isMd
            ? [{ path: file.name, kept: true, parsed: parseMarkdownSkill(text, file.name) }]
            : [{ path: file.name, kept: false, reason: "extension" }],
        );
      }
    } catch {
      setError(t("import.parseError"));
    }
  }

  const kept = (entries ?? []).filter((e) => e.kept && e.parsed);

  const confirm = async () => {
    setConfirming(true);
    try {
      for (const entry of kept) {
        await create.mutateAsync({
          name: entry.parsed!.name,
          description: entry.parsed!.description,
          body: entry.parsed!.body,
          source: "community",
          // enabled is ignored server-side for a non-manual source anyway —
          // included for clarity, not because it has any effect here.
          enabled: false,
        });
      }
      toast.success(t("import.importedToast", { name: kept[0]?.parsed?.name ?? "" }));
      onClose();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      width={560}
      title={t("import.modalTitle")}
      subtitle={kind === "file" ? t("import.modalSubtitleFile") : t("import.modalSubtitleArchive")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button kind="primary" icon="Upload" onClick={confirm} disabled={kept.length === 0 || confirming}>
            {confirming ? t("import.confirming") : t("import.confirm", { count: kept.length })}
          </Button>
        </div>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={kind === "archive" ? ".zip" : ".md,.markdown"}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <div
        role="button"
        tabIndex={0}
        style={s.drop(dragging)}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
      >
        {t("import.dropHint")}
      </div>

      {error && <div style={s.error}>{error}</div>}

      {entries && (
        <div style={s.list}>
          {entries.map((entry, i) => (
            <div key={i} style={s.entry(entry.kept)}>
              {entry.kept ? (
                <Icon.Check size={14} style={{ color: "var(--ok)", flexShrink: 0 }} />
              ) : (
                <Icon.X size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              )}
              <span style={s.entryPath} className="mono">
                {entry.path}
              </span>
              {entry.kept ? (
                <Badge color="var(--ok)">{t("import.entryKept")}</Badge>
              ) : (
                <span style={s.entryNote}>{t(REASON_KEY[entry.reason ?? "extension"])}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {kept.length > 0 && <div style={s.vettingNote}>{t("import.vettingNote")}</div>}
    </Modal>
  );
}
