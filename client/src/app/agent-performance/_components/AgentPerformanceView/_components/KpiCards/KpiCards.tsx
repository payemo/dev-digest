/* KpiCards — Total runs (with a daily sparkline), Total cost (estimated, with
   the delta vs the previous equal-length period), pooled Avg accept rate, and
   the Most-active agent. The cost delta sits below the card: MetricCard's own
   delta colours "down" red, the wrong polarity for cost. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, CircularScore, MetricCard } from "@devdigest/ui";
import type { AgentPerformance } from "@devdigest/shared";
import { formatUsd } from "@/lib/format";
import { formatLocalDate, formatRatePct, ratePct, type StatsPeriod } from "@/components/stats-period";
import { s } from "./styles";

const DAY_MS = 24 * 60 * 60 * 1000;

export function KpiCards({ data, period }: { data: AgentPerformance; period: StatsPeriod }) {
  const t = useTranslations("agentPerformance");
  const { totals, most_active: top } = data;
  const trend = data.runs_trend.length >= 2 ? data.runs_trend.map((p) => p.value) : undefined;

  return (
    <div style={s.row}>
      <div style={s.col}>
        <MetricCard label={t("kpi.totalRuns")} value={totals.runs} trend={trend} />
        {totals.failed_runs > 0 && (
          <span style={s.caption}>{t("kpi.failedRuns", { count: totals.failed_runs })}</span>
        )}
      </div>

      <div style={s.col}>
        <MetricCard
          label={t("kpi.totalCost")}
          value={
            <span style={s.costValue}>
              {formatUsd(totals.total_cost_usd)}
              <Badge>{t("cost.estimated")}</Badge>
            </span>
          }
        />
        <CostDelta data={data} period={period} />
        {totals.unpriced_runs > 0 && (
          <span style={s.caption}>{t("kpi.unpricedRuns", { count: totals.unpriced_runs })}</span>
        )}
      </div>

      <div style={s.col}>
        <MetricCard
          label={t("kpi.avgAcceptRate")}
          value={
            totals.accept_rate == null ? (
              "—"
            ) : (
              <span style={s.ringValue}>
                {formatRatePct(totals.accept_rate)}
                <CircularScore score={ratePct(totals.accept_rate)} size={38} />
              </span>
            )
          }
        />
        <span style={s.caption}>
          {totals.decisions > 0
            ? t("kpi.acrossDecisions", { accepted: totals.accepted, decisions: totals.decisions })
            : t("kpi.noDecisions")}
        </span>
      </div>

      <div style={s.col}>
        <MetricCard
          label={t("kpi.mostActive")}
          value={top ? <span style={s.agentName}>{top.agent_name}</span> : "—"}
        />
        {top && (
          <span style={s.caption}>
            {t("kpi.mostActiveDetail", {
              runs: top.runs,
              accept: formatRatePct(top.accept_rate),
              decisions: top.decisions,
            })}
          </span>
        )}
      </div>
    </div>
  );
}

/** "−$1.20 vs previous 30 days" in green, "+$…" in red, or why there is none. */
function CostDelta({ data, period }: { data: AgentPerformance; period: StatsPeriod }) {
  const t = useTranslations("agentPerformance");
  const delta = data.cost_delta_usd;
  if (delta === null) {
    return <span style={s.delta("var(--text-muted)")}>{t("delta.noPrevious")}</span>;
  }
  const span = spanLabel(data.previous_window, period, t);
  if (delta === 0) {
    return <span style={s.delta("var(--text-muted)")}>{t("delta.noChange", { span })}</span>;
  }
  const amount = formatUsd(Math.abs(delta));
  return delta < 0 ? (
    <span style={s.delta("var(--ok)")}>{t("delta.lower", { amount, span })}</span>
  ) : (
    <span style={s.delta("var(--crit)")}>{t("delta.higher", { amount, span })}</span>
  );
}

/** "vs previous 30 days" for a preset; "vs <from> – <to>" (inclusive) for custom. */
function spanLabel(
  prev: AgentPerformance["previous_window"],
  period: StatsPeriod,
  t: ReturnType<typeof useTranslations<"agentPerformance">>,
): string {
  const from = new Date(prev.from);
  const to = new Date(prev.to);
  if (period !== "custom") {
    return t("delta.vsPreviousDays", { days: Math.round((to.getTime() - from.getTime()) / DAY_MS) });
  }
  return t("delta.vsPreviousRange", {
    from: formatLocalDate(from),
    to: formatLocalDate(new Date(to.getTime() - 1)),
  });
}
