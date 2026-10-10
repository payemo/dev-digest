/* RecentEvalRuns — "Recent eval runs · all agents": agent, time, version,
   recall / precision / citation bars with %, and pass. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { EvalWorkspaceRun } from "@devdigest/shared";
import { MetricBar, METRIC_COLOR } from "@/components/eval-metrics";
import { dateTimeLabel } from "@/lib/eval-format";
import { s } from "./styles";

export function RecentEvalRuns({ runs }: { runs: EvalWorkspaceRun[] }) {
  const t = useTranslations("eval");
  if (runs.length === 0) return null;
  return (
    <div>
      <SectionLabel icon="History">{t("dashboard.recentAll")}</SectionLabel>
      <div style={s.table} role="table">
        {runs.map((r) => (
          <div key={r.id} style={s.row} role="row">
            <span style={s.agent} role="cell">
              {r.agent_name}
            </span>
            <span className="mono" style={s.time} role="cell">
              {dateTimeLabel(r.started_at)}
            </span>
            <span style={s.version} role="cell">
              v{r.agent_version}
            </span>
            <span role="cell">
              <MetricBar value={r.recall} color={METRIC_COLOR.recall} />
            </span>
            <span role="cell">
              <MetricBar value={r.precision} color={METRIC_COLOR.precision} />
            </span>
            <span role="cell">
              <MetricBar value={r.citation_accuracy} color={METRIC_COLOR.citation} />
            </span>
            <span className="tnum" style={s.pass} role="cell">
              {r.status === "completed" ? `${r.passed}/${r.cases_total}` : t(`history.${r.status}`)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
