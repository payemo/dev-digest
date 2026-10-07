/* /eval — Eval Dashboard (L06): every agent with eval cases (latest run,
   recall sparkline, metrics), Run all agents, and recent runs across agents. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";
import { useEvalDashboard } from "@/lib/hooks/eval";
import { AgentEvalRow } from "./_components/AgentEvalRow";
import { RecentEvalRuns } from "./_components/RecentEvalRuns";
import { RunAllAgentsButton } from "./_components/RunAllAgentsButton";

export default function EvalDashboardPage() {
  const t = useTranslations("eval");
  const dashboard = useEvalDashboard();
  const agents = dashboard.data?.agents ?? [];
  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  return (
    <AppShell crumb={crumb}>
      <PageContainer
        title={t("dashboard.defaultTitle")}
        subtitle={t("dashboard.subtitle")}
        actions={<RunAllAgentsButton agents={agents} />}
      >
        {dashboard.isLoading ? (
          <Skeleton height={180} />
        ) : dashboard.isError ? (
          <ErrorState body={t("dashboard.loadError")} onRetry={() => dashboard.refetch()} />
        ) : agents.length === 0 ? (
          <EmptyState icon="Gauge" title={t("dashboard.emptyAgents")} body={t("dashboard.emptyAgentsBody")} />
        ) : (
          <>
            <SectionLabel icon="Cpu">{t("dashboard.agentsHeading")}</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
              {agents.map((a) => (
                <AgentEvalRow key={a.agent_id} agent={a} />
              ))}
            </div>
            <RecentEvalRuns runs={dashboard.data?.recent_runs ?? []} />
          </>
        )}
      </PageContainer>
    </AppShell>
  );
}
