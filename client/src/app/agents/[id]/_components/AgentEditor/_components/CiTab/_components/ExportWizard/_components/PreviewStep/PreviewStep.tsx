/* PreviewStep — the files the export will create. Generated files are shown
   read-only; the workflow is editable (and resettable). The runner bundle is
   listed by size only — it is too large to preview. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton, Textarea } from "@devdigest/ui";
import type { CiPreview } from "@devdigest/shared";
import { formatBytes } from "../../helpers";
import { s } from "./styles";

export function PreviewStep({
  preview,
  loading,
  error,
  workflowYaml,
  onWorkflowChange,
  onWorkflowReset,
}: {
  preview: CiPreview | undefined;
  loading: boolean;
  error: string | null;
  workflowYaml: string | null;
  onWorkflowChange: (yaml: string) => void;
  onWorkflowReset: () => void;
}) {
  const t = useTranslations("ci");
  const [selected, setSelected] = React.useState<string | null>(null);

  if (loading && !preview) return <Skeleton height={360} />;
  if (error) return <div style={s.banner}>{error}</div>;
  if (!preview) return <div style={s.center}>{t("exportWizard.previewLoading")}</div>;

  const files = preview.files;
  // Default to the workflow — the one file the user can change.
  const current =
    files.find((f) => f.path === selected) ?? files.find((f) => f.role === "workflow") ?? files[0];

  return (
    <div>
      {preview.blocking.length > 0 && (
        <div role="alert" style={s.banner}>
          <Icon.AlertOctagon size={15} />
          <div>
            {preview.blocking.map((b) => (
              <div key={b.code}>{b.message}</div>
            ))}
          </div>
        </div>
      )}
      <div style={s.frame}>
        <div style={s.list}>
          <div style={s.listLabel}>{t("exportWizard.filesToCreate")}</div>
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              className="mono"
              onClick={() => setSelected(f.path)}
              aria-current={f.path === current?.path}
              style={s.file(f.path === current?.path)}
            >
              <Icon.FileText size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              {f.path}
            </button>
          ))}
        </div>
        {current && (
          <div style={s.viewer}>
            <div style={s.viewerHead}>
              <span className="mono" style={s.viewerPath}>
                {current.path}
              </span>
              {current.role === "workflow" && workflowYaml != null && (
                <button type="button" style={s.resetBtn} onClick={onWorkflowReset}>
                  {t("exportWizard.resetWorkflow")}
                </button>
              )}
              {current.editable ? (
                <Badge icon="Edit">{t("exportWizard.editable")}</Badge>
              ) : (
                <Badge>{t("exportWizard.readOnly")}</Badge>
              )}
            </div>
            {current.role === "runner" ? (
              <div style={s.runnerNote}>
                {t("exportWizard.runnerFile", { size: formatBytes(current.size_bytes) })}
              </div>
            ) : current.role === "workflow" ? (
              <div style={s.editor}>
                <Textarea
                  mono
                  rows={16}
                  value={workflowYaml ?? current.contents}
                  onChange={onWorkflowChange}
                />
              </div>
            ) : (
              <pre className="mono" style={s.pre}>
                {current.contents}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
