/* /eval/:agentId — per-agent eval detail (L06): header (agent switcher,
   window, Run eval with live progress), the precision-dip banner, metric
   tiles with sparklines, the metric trend, and recent runs with Compare. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { EvalMetricTiles } from "@/components/eval-metrics";
import { PageContainer } from "@/components/page-shell";
import { useEvalAgentDetail, useEvalRunWatcher, useStartEvalRun } from "@/lib/hooks/eval";
import { CompareRunsModal } from "./_components/CompareRunsModal";
import { EvalDetailHeader } from "./_components/EvalDetailHeader";
import { MetricTrend } from "./_components/MetricTrend";
import { PrecisionDipBanner } from "./_components/PrecisionDipBanner";
import { RecentRunsTable } from "./_components/RecentRunsTable";

const DEFAULT_DAYS = 30;

export default function EvalAgentDetailPage() {
  const t = useTranslations("eval");
  const { agentId } = useParams<{ agentId: string }>();
  const [days, setDays] = React.useState(DEFAULT_DAYS);
  const [comparing, setComparing] = React.useState<[string, string] | null>(null);
  const detail = useEvalAgentDetail(agentId, days);
  const start = useStartEvalRun();
  const inFlight = detail.data?.in_flight ?? null;
  const watched = useEvalRunWatcher(inFlight?.id);
  const liveRun = watched.data ? (watched.data.status === "running" ? watched.data : null) : inFlight;

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: detail.data?.agent_name ?? "…" },
  ];

  return (
    <AppShell crumb={crumb}>
      <PageContainer>
        {detail.isLoading ? (
          <Skeleton height={240} />
        ) : detail.isError || !detail.data ? (
          <ErrorState body={t("detail.loadError")} onRetry={() => detail.refetch()} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <EvalDetailHeader
              detail={detail.data}
              days={days}
              onDays={setDays}
              liveRun={liveRun}
              results={watched.data?.results}
              starting={start.isPending}
              onRun={() => start.mutate(agentId)}
            />
            {detail.data.alert && <PrecisionDipBanner alert={detail.data.alert} />}
            <EvalMetricTiles latest={detail.data.latest} delta={detail.data.delta} trend={detail.data.trend} />
            <MetricTrend trend={detail.data.trend} />
            <RecentRunsTable runs={detail.data.recent_runs} onCompare={(a, b) => setComparing([a, b])} />
          </div>
        )}
        {comparing && (
          <CompareRunsModal
            agentId={agentId}
            a={comparing[0]}
            b={comparing[1]}
            onClose={() => setComparing(null)}
          />
        )}
      </PageContainer>
    </AppShell>
  );
}
