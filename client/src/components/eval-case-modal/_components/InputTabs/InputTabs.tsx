/* InputTabs — the case's frozen input: Diff (rendered as plain coloured text,
   never Markdown/HTML), Files (reference-only — never sent to the agent) and
   PR meta. Read-only for a case seeded from a finding (frozen at creation). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, IconBtn, Tabs, TextInput, Textarea } from "@devdigest/ui";
import type { EvalInputFile, EvalPrMeta } from "@devdigest/shared";
import { DIFF_ROWS } from "../../constants";
import { diffLineKind } from "../../helpers";
import { s as modal } from "../../styles";
import { s } from "./styles";

type InputTab = "diff" | "files" | "meta";

function DiffPreview({ diff }: { diff: string }) {
  return (
    <pre className="mono" style={modal.pre} data-testid="eval-diff-preview">
      {diff.split("\n").map((line, i) => (
        // Lines are positional and the text is frozen: index keys are stable here.
        <span key={i} style={modal.diffLine(diffLineKind(line))}>
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

export function InputTabs({
  diff,
  files,
  meta,
  readOnly,
  onDiff,
  onFiles,
  onMeta,
}: {
  diff: string;
  files: EvalInputFile[];
  meta: EvalPrMeta;
  readOnly: boolean;
  onDiff: (v: string) => void;
  onFiles: (v: EvalInputFile[]) => void;
  onMeta: (v: EvalPrMeta) => void;
}) {
  const t = useTranslations("eval");
  const [tab, setTab] = React.useState<InputTab>("diff");
  const tabs = [
    { key: "diff", label: t("caseEditor.tabs.diff") },
    { key: "files", label: t("caseEditor.tabs.files") },
    { key: "meta", label: t("caseEditor.tabs.prMeta") },
  ];
  return (
    <div>
      <div style={modal.label}>{t("caseEditor.inputLabel")}</div>
      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as InputTab)} pad="0" />
      <div style={s.panel}>
        {tab === "diff" &&
          (readOnly ? (
            <DiffPreview diff={diff} />
          ) : (
            <>
              <Textarea value={diff} onChange={onDiff} rows={DIFF_ROWS} mono placeholder={t("caseEditor.diffPlaceholder")} />
              {diff.trim() && <DiffPreview diff={diff} />}
            </>
          ))}

        {tab === "files" && (
          <div style={s.files}>
            <div style={s.notice} role="note">
              {t("modal.filesReferenceOnly")}
            </div>
            {files.length === 0 && readOnly && <div style={s.muted}>{t("modal.filesEmpty")}</div>}
            {files.map((f, i) =>
              readOnly ? (
                <div key={`${f.path}-${i}`} className="mono" style={s.fileRow}>
                  {f.path}
                </div>
              ) : (
                <div key={i} style={s.fileEdit}>
                  <div style={{ flex: 1 }}>
                    <TextInput
                      mono
                      value={f.path}
                      placeholder={t("modal.filePathPlaceholder")}
                      onChange={(v) => onFiles(files.map((x, j) => (j === i ? { ...x, path: v } : x)))}
                    />
                  </div>
                  <IconBtn icon="Trash" label={t("modal.removeFile")} onClick={() => onFiles(files.filter((_, j) => j !== i))} />
                </div>
              ),
            )}
            {!readOnly && (
              <div>
                <Button kind="ghost" size="sm" icon="Plus" onClick={() => onFiles([...files, { path: "" }])}>
                  {t("modal.addFile")}
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === "meta" &&
          (readOnly ? (
            <dl style={s.meta}>
              <dt style={s.metaKey}>{t("modal.meta.number")}</dt>
              <dd style={s.metaVal}>{meta.number ?? "—"}</dd>
              <dt style={s.metaKey}>{t("modal.meta.title")}</dt>
              <dd style={s.metaVal}>{meta.title}</dd>
              <dt style={s.metaKey}>{t("modal.meta.author")}</dt>
              <dd style={s.metaVal}>{meta.author ?? "—"}</dd>
              <dt style={s.metaKey}>{t("modal.meta.description")}</dt>
              <dd style={{ ...s.metaVal, whiteSpace: "pre-wrap" }}>{meta.description ?? "—"}</dd>
            </dl>
          ) : (
            <div style={s.files}>
              <label style={modal.label}>{t("caseEditor.titleLabel")}</label>
              <TextInput
                value={meta.title}
                placeholder={t("caseEditor.titlePlaceholder")}
                onChange={(v) => onMeta({ ...meta, title: v })}
              />
              <label style={modal.label}>{t("caseEditor.numberLabel")}</label>
              <TextInput
                type="number"
                value={meta.number == null ? "" : String(meta.number)}
                onChange={(v) => onMeta({ ...meta, number: v.trim() ? Math.trunc(Number(v)) : null })}
              />
              <label style={modal.label}>{t("caseEditor.descriptionLabel")}</label>
              <Textarea
                value={meta.description ?? ""}
                rows={4}
                placeholder={t("caseEditor.bodyPlaceholder")}
                onChange={(v) => onMeta({ ...meta, description: v })}
              />
            </div>
          ))}
      </div>
    </div>
  );
}
