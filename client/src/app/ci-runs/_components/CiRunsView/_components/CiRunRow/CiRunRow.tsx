/* CiRunRow — one CI run: when, repo, PR, agent, verdict, re-grounded
   findings, CI-reported cost/duration, status (+ unverified) and the job link.
   Every value is rendered as plain text. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { formatUsd } from "@/lib/format";
import { dateTimeLabel } from "@/lib/eval-format";
import { STATUS_LABEL_KEY } from "../../constants";
import { runStatusOf, statusTone } from "@/lib/ci-status";
import { formatDuration, prHref, safeHttpUrl, verdictTone } from "../../helpers";
import { s } from "./styles";

export function CiRunRow({ run }: { run: CiRun }) {
  const t = useTranslations("ci");
  const pr = prHref(run);
  const status = runStatusOf(run.status);
  const jobUrl = safeHttpUrl(run.job_url ?? run.github_url);
  const reported = run.reported_findings_count;
  const findingsDiffer = reported != null && run.findings_count != null && reported !== run.findings_count;

  return (
    <div role="row" style={s.row}>
      <span role="cell" className="mono" style={s.muted}>
        {run.ran_at ? dateTimeLabel(run.ran_at) : "—"}
      </span>
      <span role="cell" className="mono" style={s.cell}>
        {run.repo ?? "—"}
      </span>
      <span role="cell">
        {pr ? (
          pr.external ? (
            <a href={pr.href} target="_blank" rel="noopener noreferrer" style={s.link}>
              #{run.pr_number}
            </a>
          ) : (
            <Link href={pr.href} style={s.link}>
              #{run.pr_number}
            </Link>
          )
        ) : (
          "—"
        )}
      </span>
      <span role="cell" style={s.cell}>
        {run.agent_id ? (
          <Link href={`/agents/${run.agent_id}?tab=ci`} style={s.link}>
            {run.agent ?? "—"}
          </Link>
        ) : (
          (run.agent ?? "—")
        )}
      </span>
      <span role="cell">
        {run.verdict ? (
          <Badge {...verdictTone(run.verdict)}>{t(`runs.verdicts.${run.verdict}`)}</Badge>
        ) : (
          "—"
        )}
      </span>
      <span
        role="cell"
        className="tnum"
        title={findingsDiffer ? t("runs.ciReported", { count: reported }) : undefined}
      >
        {run.findings_count ?? "—"}
        {findingsDiffer && <span style={s.muted}> ({reported})</span>}
      </span>
      <span role="cell" className="tnum" title={t("runs.reportedByCi")}>
        {formatUsd(run.cost_usd)}
      </span>
      <span role="cell" className="tnum" title={t("runs.reportedByCi")}>
        {formatDuration(run.duration_ms)}
      </span>
      <span role="cell" style={s.status}>
        {status && (
          <Badge dot {...statusTone(status)}>
            {t(`runs.status.${STATUS_LABEL_KEY[status]}`)}
          </Badge>
        )}
        {run.verification === "unverified" && (
          <span title={t("runs.unverifiedHint")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("runs.unverified")}
            </Badge>
          </span>
        )}
      </span>
      <span role="cell">
        {jobUrl && (
          <a href={jobUrl} target="_blank" rel="noopener noreferrer" style={s.jobLink}>
            {t("runs.viewJob")}
            <Icon.ExternalLink size={12} />
          </a>
        )}
      </span>
    </div>
  );
}
