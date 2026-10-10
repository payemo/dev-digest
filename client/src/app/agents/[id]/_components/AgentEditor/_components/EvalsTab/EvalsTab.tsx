/* EvalsTab — the agent's eval harness: metric tiles for the latest full run,
   the case set with per-case last results, Run all evals (background run with
   live k/n progress, re-attached after navigation), New eval case, and the
   full-run history. In-flight state lives on the server, so reopening the tab
   mid-run shows the same run. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCaseRecord } from "@devdigest/shared";
import { EvalCaseModal, type EvalCaseModalMode } from "@/components/eval-case-modal";
import { EvalMetricTiles, RunProgress } from "@/components/eval-metrics";
import {
  useDeleteEvalCase,
  useEvalAgentDetail,
  useEvalAgentRuns,
  useEvalCases,
  useEvalRunWatcher,
  useRunEvalCase,
  useStartEvalRun,
} from "@/lib/hooks/eval";
import { EvalCaseRow } from "./_components/EvalCaseRow";
import { EvalRunHistory } from "./_components/EvalRunHistory";
import { passingCounts } from "./helpers";
import { s } from "./styles";

/** Window (days) of the tiles' "previous run" and the history list. */
const WINDOW_DAYS = 30;

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const detail = useEvalAgentDetail(agent.id, WINDOW_DAYS);
  const cases = useEvalCases(agent.id);
  const runs = useEvalAgentRuns(agent.id, WINDOW_DAYS);
  const start = useStartEvalRun();
  const runCase = useRunEvalCase();
  const del = useDeleteEvalCase();
  const [modal, setModal] = React.useState<EvalCaseModalMode | null>(null);

  // The server's in-flight run is the source of truth (survives reloads); the
  // watcher keeps following it to completion, then refreshes every eval view.
  const inFlight = detail.data?.in_flight ?? null;
  const watched = useEvalRunWatcher(inFlight?.id);
  const liveRun = watched.data ? (watched.data.status === "running" ? watched.data : null) : inFlight;

  const list = cases.data ?? [];
  const { passing, withResult } = passingCounts(list);

  const onDelete = (c: EvalCaseRecord) => {
    if (window.confirm(t("cases.confirmDelete", { name: c.name }))) del.mutate(c.id);
  };

  return (
    <div style={s.wrap}>
      <div>
        <SectionLabel
          icon="Gauge"
          right={
            <Link href={`/eval/${agent.id}`} style={s.link}>
              {t("tiles.viewDashboard")}
            </Link>
          }
        >
          {t("evalsTab.metricsTitle")}
        </SectionLabel>
        {detail.isLoading ? (
          <Skeleton height={96} />
        ) : detail.isError ? (
          <ErrorState body={t("detail.loadError")} onRetry={() => detail.refetch()} />
        ) : (
          <EvalMetricTiles latest={detail.data?.latest ?? null} delta={detail.data!.delta} showTracesPassed />
        )}
        <p style={s.note}>
          <Icon.Code size={13} />
          {t("tiles.scoringNote")}
        </p>
      </div>

      <div style={s.casesHeader}>
        <h2 style={s.h2}>{t("cases.heading")}</h2>
        <Badge color="var(--warn)" bg="var(--warn-bg)">
          {t("cases.passing", { passing, withResult })}
        </Badge>
        <Badge>{t("cases.total", { count: list.length })}</Badge>
        <div style={s.headerActions}>
          <span title={list.length === 0 ? t("cases.noCasesRunDisabled") : undefined}>
            <Button
              kind="secondary"
              size="sm"
              icon={liveRun ? undefined : "Play"}
              loading={!!liveRun || start.isPending}
              disabled={list.length === 0}
              onClick={() => start.mutate(agent.id)}
            >
              {liveRun ? t("progress.running") : t("cases.runAll")}
            </Button>
          </span>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setModal({ kind: "new", agentId: agent.id })}>
            {t("cases.newCase")}
          </Button>
        </div>
      </div>

      {liveRun && (
        <div style={s.progressBox}>
          <RunProgress run={liveRun} results={watched.data?.results} />
        </div>
      )}

      {cases.isLoading ? (
        <Skeleton height={120} />
      ) : cases.isError ? (
        <ErrorState body={t("cases.loadError")} onRetry={() => cases.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon="FlaskConical" title={t("cases.empty")} body={t("cases.emptyBody")} />
      ) : (
        <div style={s.list}>
          {list.map((c) => (
            <EvalCaseRow
              key={c.id}
              c={c}
              running={runCase.isPending && runCase.variables === c.id}
              onRun={() => runCase.mutate(c.id)}
              onEdit={() => setModal({ kind: "edit", caseRecord: c })}
              onDelete={() => onDelete(c)}
            />
          ))}
        </div>
      )}

      <EvalRunHistory runs={runs.data ?? []} loading={runs.isLoading} />

      {modal && <EvalCaseModal mode={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
