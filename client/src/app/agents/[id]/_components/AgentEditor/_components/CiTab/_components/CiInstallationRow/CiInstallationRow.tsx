/* CiInstallationRow — one repo the agent is installed in: target, last run
   status + time, PR link, "Update available" and unverified-run badges. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { CiInstallation } from "@devdigest/shared";
import { statusTone } from "@/lib/ci-status";
import { lastRunView, timeAgo } from "../../helpers";
import { s } from "./styles";

export function CiInstallationRow({ installation }: { installation: CiInstallation }) {
  const t = useTranslations("ci");
  const last = lastRunView(installation);
  const meta = installation.branch
    ? t("ciTab.versions", {
        workflow: installation.workflow_version ?? "?",
        manifest: installation.manifest_version ?? "?",
        runner: installation.runner_version ?? "?",
      })
    : t("ciTab.zipInstall");

  return (
    <div style={s.row}>
      <Icon.GitBranch size={15} style={s.icon} />
      <div style={s.main}>
        <div className="mono" style={s.repo}>
          {installation.repo}
        </div>
        <div style={s.meta}>{meta}</div>
      </div>
      <div style={s.right}>
        {installation.outdated && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="RefreshCw">
            {t("ciTab.updateAvailable")}
          </Badge>
        )}
        {installation.pr_url && (
          <a href={installation.pr_url} target="_blank" rel="noopener noreferrer" style={s.link}>
            <Icon.GitPullRequest size={13} />
            {t("ciTab.viewPr")}
          </a>
        )}
        <Badge icon="Workflow">{t("exportWizard.targets.gha")}</Badge>
        {last.kind === "unverified" && (
          <span title={t("ciTab.unverifiedHint")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("ciTab.unverifiedRun")}
            </Badge>
          </span>
        )}
        {last.kind === "status" && (
          <Badge dot {...statusTone(last.status)}>
            {t(`ciTab.lastRun.${last.status}`)}
          </Badge>
        )}
        <span style={s.time}>{last.kind === "none" ? t("ciTab.noRuns") : timeAgo(last.ranAt)}</span>
      </div>
    </div>
  );
}
