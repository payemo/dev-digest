/* CiRunsView — every agent review that ran inside CI (pulled back from GitHub
   Actions), filterable by window / agent / repo / status via the URL. Syncs
   on open and every 2 minutes; Refresh syncs now and reports the outcome. */
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { PageContainer } from "@/components/page-shell";
import { useAgents } from "@/lib/hooks/agents";
import { useCiAutoSync, useCiRuns, useCiSync } from "@/lib/hooks/ci";
import { useActiveRepo } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { CiRunsFilters } from "./_components/CiRunsFilters";
import { CiRunRow } from "./_components/CiRunRow";
import { queryFromParams, withParam } from "./helpers";
import { s } from "./styles";

const COLUMNS = [
  "timestamp",
  "repository",
  "pullRequest",
  "agent",
  "verdict",
  "findings",
  "cost",
  "duration",
  "status",
  "job",
] as const;

export function CiRunsView() {
  const t = useTranslations("ci");
  const router = useRouter();
  const pathname = usePathname() ?? "/ci-runs";
  const params = useSearchParams();
  const search = new URLSearchParams(params?.toString() ?? "");
  const query = queryFromParams(search);

  const runs = useCiRuns(query);
  const sync = useCiSync();
  const agents = useAgents();
  const { repos } = useActiveRepo();
  const toast = useToast();
  useCiAutoSync(true);

  const onFilter = (key: string, value: string | null) => {
    const qs = withParam(search, key, value);
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const onRefresh = () =>
    sync.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(t("runs.syncSummary", { ingested: r.ingested, rejected: r.rejected.length })),
      onError: (err) => toast.error(t("runs.syncFailed", { message: (err as Error).message })),
    });

  const list = runs.data ?? [];
  return (
    <PageContainer
      title={t("runs.title")}
      subtitle={t("runs.subtitle")}
      actions={
        <div style={s.actions}>
          <span style={s.auto}>
            <span style={s.dot} />
            {t("runs.autoRefresh")}
          </span>
          <Button icon="RefreshCw" loading={sync.isPending} onClick={onRefresh}>
            {sync.isPending ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>
      }
    >
      <CiRunsFilters
        query={query}
        agents={(agents.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
        repos={repos.map((r) => r.full_name)}
        onChange={onFilter}
      />
      {runs.isLoading ? (
        <Skeleton height={200} />
      ) : runs.isError ? (
        <ErrorState body={t("runs.loadError")} onRetry={() => runs.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
      ) : (
        <div role="table" style={s.table}>
          <div role="row" style={s.head}>
            {COLUMNS.map((c) => (
              <span key={c} role="columnheader">
                {t(`runs.table.${c}`)}
              </span>
            ))}
          </div>
          {list.map((run) => (
            <CiRunRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
