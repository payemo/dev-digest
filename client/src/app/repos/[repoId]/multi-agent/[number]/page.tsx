/* Route: /repos/:repoId/multi-agent/:number — Multi-Agent Review results for
   a PR: always that PR's LATEST multi-agent run, live while it runs.
   Search params: ?view=columns|tabs · ?agent=<run_id> · ?finding=<id> ·
   ?trace=<run_id>. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { usePulls } from "@/lib/hooks";
import { useLatestPrMultiAgentRun } from "@/lib/hooks/multi-agent";
import { multiAgentKeys } from "@/lib/hooks/keys";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { ResultsHeader } from "../_components/ResultsHeader";
import { ColumnsView } from "../_components/ColumnsView";
import { TabsView } from "../_components/TabsView";
import { Disagreements } from "../_components/Disagreements";
import { PARAM } from "../constants";
import { readView, withParams } from "../helpers";

export default function MultiAgentResultsPage() {
  const t = useTranslations("multiAgent");
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  // The route is keyed by PR number; the API by the PR's uuid.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prNumber = Number(number);
  const pull = pulls?.find((p) => p.number === prNumber) ?? null;
  const prId = pull?.id ?? null;
  const latest = useLatestPrMultiAgentRun(prId);

  const mode = readView(search);
  const setParams = (updates: Parameters<typeof withParams>[1]) => {
    const sp = withParams(search, updates).toString();
    router.replace(`/repos/${repoId}/multi-agent/${number}${sp ? `?${sp}` : ""}`);
  };
  const refresh = React.useCallback(
    () => qc.invalidateQueries({ queryKey: multiAgentKeys.latestForPull(prId) }),
    [qc, prId],
  );
  const configureHref = `/repos/${repoId}/multi-agent/new?pr=${number}`;

  const crumb = [
    { label: t("crumb.area"), href: `/repos/${repoId}/multi-agent` },
    { label: `#${number}`, mono: true },
  ];
  const wrap = (body: React.ReactNode) => <AppShell crumb={crumb}>{body}</AppShell>;

  if (repoNotFound) return wrap(<RepoNotFound />);
  if (pullsLoading || (prId != null && latest.isLoading)) {
    return wrap(
      <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={28} width={420} />
        <Skeleton height={240} />
      </div>,
    );
  }
  if (!pull) {
    return wrap(<ErrorState fullScreen title={t("results.loadError")} body={t("results.prNotFound", { number })} />);
  }
  if (latest.isError) {
    return wrap(
      <ErrorState
        fullScreen
        title={t("results.loadError")}
        body={latest.error instanceof ApiError ? latest.error.message : undefined}
        onRetry={() => latest.refetch()}
      />,
    );
  }
  const view = latest.data;
  if (!view) {
    return wrap(
      <EmptyState
        icon="Users"
        title={t("results.emptyTitle")}
        body={t("results.emptyBody")}
        cta={t("results.emptyAction")}
        onCta={() => router.push(configureHref)}
      />,
    );
  }

  const traceRunId = search.get(PARAM.trace);
  const traceColumn = view.columns.find((c) => c.run_id === traceRunId) ?? null;
  const openTrace = (runId: string) => setParams({ trace: runId });

  return wrap(
    <>
      <ResultsHeader
        view={view}
        mode={mode}
        onMode={(m) => setParams({ view: m === "columns" ? null : m })}
        onConfigure={() => router.push(configureHref)}
        onNewRun={() => router.push(`/repos/${repoId}/multi-agent/new`)}
      />
      <div style={{ padding: "20px 32px 44px", display: "flex", flexDirection: "column", gap: 28 }}>
        {mode === "columns" ? (
          <ColumnsView
            columns={view.columns}
            onOpenFinding={(runId, findingId) =>
              setParams({ view: "tabs", agent: runId, finding: findingId })
            }
            onOpenTrace={openTrace}
            onRunSettled={refresh}
          />
        ) : (
          <TabsView
            columns={view.columns}
            activeRunId={search.get(PARAM.agent)}
            expandedFindingId={search.get(PARAM.finding)}
            prId={view.pr_id}
            repoFullName={activeRepo?.full_name ?? null}
            headSha={pull.head_sha}
            onSelect={(runId) => setParams({ agent: runId, finding: null })}
            onOpenTrace={openTrace}
            onRunSettled={refresh}
          />
        )}
        <Disagreements rows={view.disagreements} columns={view.columns} />
      </div>
      {traceColumn && (
        <RunTraceDrawer
          runId={traceColumn.run_id}
          prNumber={view.pr_number}
          agentName={traceColumn.agent_name}
          findings={traceColumn.findings}
          running={traceColumn.status === "running"}
          onClose={() => setParams({ trace: null })}
        />
      )}
    </>,
  );
}
