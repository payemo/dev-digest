/* AgentPerformanceView — the dashboard body: period selector, KPI cards,
   per-agent table and cost breakdown, all from one GET /agent-performance.
   Loading renders skeletons and errors render ErrorState — never zeros. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { PageContainer } from "@/components/page-shell";
import type { AgentPerformance } from "@devdigest/shared";
import {
  StatsPeriodSelector,
  periodSearchParams,
  useStatsPeriod,
  type StatsPeriod,
} from "@/components/stats-period";
import { useAgentPerformance } from "@/lib/hooks/agent-performance";
import { KpiCards } from "./_components/KpiCards";
import { AgentTable } from "./_components/AgentTable";
import { CostBreakdown } from "./_components/CostBreakdown";
import { s } from "./styles";

export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const period = useStatsPeriod();
  const { data, isError, isFetching, isPlaceholderData, refetch } = useAgentPerformance(period.window);

  return (
    <PageContainer
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        <>
          {isFetching && isPlaceholderData && (
            <span style={s.updating} aria-live="polite">
              <Icon.RefreshCw size={12} />
              {t("updating")}
            </span>
          )}
          <StatsPeriodSelector value={period} />
        </>
      }
    >
      <Body
        data={data}
        isError={isError}
        hasWindow={period.window !== null}
        periodQuery={periodSearchParams(period.state)}
        period={period.period}
        onRetry={() => refetch()}
      />
    </PageContainer>
  );
}

function Body({
  data,
  isError,
  hasWindow,
  periodQuery,
  period,
  onRetry,
}: {
  data: AgentPerformance | undefined;
  isError: boolean;
  hasWindow: boolean;
  periodQuery: string;
  period: StatsPeriod;
  onRetry: () => void;
}) {
  const t = useTranslations("agentPerformance");

  if (isError) return <ErrorState body={t("loadError")} onRetry={onRetry} />;
  if (!data) {
    // An invalid custom range fires no request; the selector explains why.
    if (!hasWindow) return null;
    return (
      <div style={s.body} aria-busy="true" data-testid="agent-performance-loading">
        <div style={s.kpiSkeletons}>
          <Skeleton height={118} />
          <Skeleton height={118} />
          <Skeleton height={118} />
          <Skeleton height={118} />
        </div>
        <Skeleton height={180} />
        <Skeleton height={160} />
      </div>
    );
  }
  if (data.totals.runs === 0 && data.totals.failed_runs === 0) {
    return <EmptyState icon="Activity" title={t("empty.title")} body={t("empty.body")} />;
  }

  return (
    <div style={s.body}>
      <KpiCards data={data} period={period} />
      {data.cost_basis === "estimate" && <p style={s.provenance}>{t("cost.provenance")}</p>}
      <AgentTable
        rows={data.agents}
        minDecisions={data.min_decisions_for_ranking}
        periodQuery={periodQuery}
      />
      {data.totals.deleted_agent_runs > 0 && (
        <p style={s.footnote}>{t("deletedAgentRuns", { count: data.totals.deleted_agent_runs })}</p>
      )}
      <CostBreakdown data={data} />
    </div>
  );
}
