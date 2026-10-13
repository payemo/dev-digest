/* StatsTab — one agent's runs, avg cost, avg duration and accept rate for the
   period in `?period=`, from GET /agents/:id/stats. The server builds this with
   the same aggregation as the Agent Performance dashboard row, so the two
   show identical numbers for the same window. Loading and errors render
   skeletons / ErrorState — never zeros. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, BarRow, EmptyState, ErrorState, MetricCard, SEV, Skeleton } from "@devdigest/ui";
import type { Agent, AgentStats } from "@devdigest/shared";
import { formatDurationEstimate, formatUsd } from "@/lib/format";
import { useAgentStats } from "@/lib/hooks/agent-performance";
import {
  StatsPeriodSelector,
  TrendArrow,
  formatRatePct,
  useStatsPeriod,
} from "@/components/stats-period";
import { s } from "./styles";

const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

export function StatsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const period = useStatsPeriod();
  const { data, isError, isFetching, isPlaceholderData, refetch } = useAgentStats(agent.id, period.window);
  // Placeholder data from another agent (switching agents) is not this agent's.
  const stats = data && data.agent_id === agent.id ? data : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <div style={s.title}>{t("editor.stats.title")}</div>
          {isFetching && isPlaceholderData && stats && (
            <span style={s.updating} aria-live="polite">
              {t("editor.stats.updating")}
            </span>
          )}
        </div>
        <StatsPeriodSelector value={period} />
      </div>
      <Body
        stats={stats}
        isError={isError}
        hasWindow={period.window !== null}
        onRetry={() => refetch()}
      />
    </div>
  );
}

function Body({
  stats,
  isError,
  hasWindow,
  onRetry,
}: {
  stats: AgentStats | undefined;
  isError: boolean;
  hasWindow: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("agents");
  const tp = useTranslations("agentPerformance");

  if (isError) return <ErrorState body={t("editor.stats.loadError")} onRetry={onRetry} />;
  if (!stats) {
    if (!hasWindow) return null;
    return (
      <div style={s.metricsRow} aria-busy="true" data-testid="agent-stats-loading">
        <Skeleton height={100} />
        <Skeleton height={100} />
        <Skeleton height={100} />
        <Skeleton height={100} />
      </div>
    );
  }
  if (stats.runs === 0 && stats.failed_runs === 0) {
    return <EmptyState icon="BarChart" title={t("editor.stats.noRuns")} body={t("editor.stats.noRunsBody")} />;
  }

  const trend = stats.trend.length >= 2 ? stats.trend.map((p) => p.value) : undefined;
  const maxSeverity = Math.max(1, ...SEVERITIES.map((k) => stats.findings_by_severity[k]));

  return (
    <>
      <div style={s.metricsRow}>
        <div style={s.metricCol}>
          <MetricCard label={t("editor.stats.runs")} value={stats.runs} trend={trend} />
        </div>
        <div style={s.metricCol}>
          <MetricCard
            label={t("editor.stats.avgCost")}
            value={
              <span style={s.costValue}>
                {formatUsd(stats.avg_cost_usd)}
                <Badge>{tp("cost.estimated")}</Badge>
              </span>
            }
          />
          {stats.total_cost_usd !== null && (
            <span style={s.metricCaption}>
              {t("editor.stats.totalCost", { amount: formatUsd(stats.total_cost_usd) })}
            </span>
          )}
        </div>
        <div style={s.metricCol}>
          <MetricCard
            label={t("editor.stats.avgDuration")}
            value={formatDurationEstimate(stats.avg_latency_ms) ?? "—"}
          />
        </div>
        <div style={s.metricCol}>
          <MetricCard label={t("editor.stats.acceptRate")} value={formatRatePct(stats.accept_rate)} />
          <span style={s.metricCaption}>
            {stats.decisions > 0
              ? t("editor.stats.acrossDecisions", { accepted: stats.accepted, decisions: stats.decisions })
              : t("editor.stats.noDecisions")}
            <TrendArrow trend={stats.accept_trend} deltaPp={stats.accept_rate_delta_pp} />
            {stats.low_sample && stats.decisions > 0 && (
              <span title={t("editor.stats.lowSampleHint")}>
                <Badge color="var(--warn)" bg="var(--warn-bg)">
                  {t("editor.stats.lowSample")}
                </Badge>
              </span>
            )}
          </span>
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>{t("editor.stats.bySeverity")}</div>
        {SEVERITIES.map((k) => (
          <BarRow
            key={k}
            label={t(`editor.stats.severity.${k}`)}
            value={stats.findings_by_severity[k]}
            max={maxSeverity}
            color={SEV[k].c}
            suffix={String(stats.findings_by_severity[k])}
          />
        ))}
      </div>

      <div style={s.facts}>
        <span>{t("editor.stats.failedRuns", { count: stats.failed_runs })}</span>
        <span>{t("editor.stats.unpricedRuns", { count: stats.unpriced_runs })}</span>
        <span>{t("editor.stats.pending", { count: stats.pending })}</span>
      </div>

      {stats.cost_basis === "estimate" && <p style={s.note}>{tp("cost.provenance")}</p>}
    </>
  );
}
