/* InstallStep — open a PR on devdigest/ci with the files, or download them as
   a zip; plus the repository secret the workflow needs. Shows the outcome once
   the install has run. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { SECRETS_DOCS_URL } from "../../constants";
import { s } from "./styles";

export type InstallAction = "open_pr" | "files";

export type InstallResult = { kind: "pr"; prUrl: string | null } | { kind: "zip" };

export function InstallStep({
  repo,
  fileCount,
  secretNames,
  action,
  onAction,
  error,
  result,
}: {
  repo: string;
  fileCount: number;
  secretNames: string[];
  action: InstallAction;
  onAction: (a: InstallAction) => void;
  error: string | null;
  result: InstallResult | null;
}) {
  const t = useTranslations("ci");

  if (result?.kind === "pr") {
    return (
      <div role="status" style={s.success}>
        <Icon.CheckCircle size={28} style={{ color: "var(--ok)" }} />
        <div style={s.successTitle}>{t("exportWizard.successPrTitle")}</div>
        <div style={s.muted}>{t("exportWizard.successPrBody", { branch: "devdigest/ci", repo })}</div>
        {result.prUrl && (
          <a href={result.prUrl} target="_blank" rel="noopener noreferrer" style={s.prLink}>
            <Icon.GitPullRequest size={14} />
            {t("exportWizard.viewPr")}
          </a>
        )}
      </div>
    );
  }
  if (result?.kind === "zip") {
    return (
      <div role="status" style={s.success}>
        <Icon.CheckCircle size={28} style={{ color: "var(--ok)" }} />
        <div style={s.successTitle}>{t("exportWizard.successZipTitle")}</div>
        <div style={s.muted}>{t("exportWizard.successZipBody", { repo })}</div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div role="radiogroup" aria-label={t("exportWizard.steps.install")} style={s.wrap}>
        <button
          type="button"
          role="radio"
          aria-checked={action === "open_pr"}
          onClick={() => onAction("open_pr")}
          style={s.option(action === "open_pr")}
        >
          <div style={s.optionHead}>
            <Icon.GitPullRequest size={15} />
            <span style={s.optionTitle}>{t("exportWizard.installCardTitle")}</span>
            <Badge color="var(--accent-text)" bg="var(--accent-bg)">
              {t("exportWizard.recommended")}
            </Badge>
          </div>
          <div style={s.optionBody}>
            {t("exportWizard.installCardBody", { repo, count: fileCount })}
          </div>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={action === "files"}
          onClick={() => onAction("files")}
          style={s.option(action === "files")}
        >
          <div style={s.optionHead}>
            <Icon.Copy size={15} />
            <span style={s.optionTitle}>{t("exportWizard.installZipTitle")}</span>
            <span style={s.muted}>{t("exportWizard.installZipHint")}</span>
          </div>
        </button>
      </div>
      {secretNames.map((key) => (
        <div key={key} style={s.muted}>
          <Icon.Lock size={12} /> {t("exportWizard.secretNote", { key })}
        </div>
      ))}
      {error && (
        <div role="alert" style={s.error}>
          {error}
        </div>
      )}
      <div style={s.help}>
        {t("exportWizard.setupDocsPrefix")}{" "}
        <a href={SECRETS_DOCS_URL} target="_blank" rel="noopener noreferrer" style={s.link}>
          {t("exportWizard.setupDocs")} →
        </a>
      </div>
    </div>
  );
}
