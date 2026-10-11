/* TabsView — Tabs + detail: one tab per child run; the active tab shows its
   summary card, then the actionable FindingCards (Accept / Reject / eval case,
   plus a disabled Learn) — or the live log while running, or the error. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, Tabs, scoreColor } from "@devdigest/ui";
import type { MultiAgentColumn } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card";
import { useFindingAction } from "@/lib/hooks/reviews";
import { formatDurationEstimate, formatUsd } from "@/lib/format";
import { COLUMN_LOG_HEIGHT } from "../../constants";
import { agentIdentity } from "../../helpers";
import { LiveRunLog } from "../LiveRunLog";
import { s } from "./styles";

export function TabsView({
  columns,
  activeRunId,
  expandedFindingId,
  prId,
  repoFullName,
  headSha,
  onSelect,
  onOpenTrace,
  onRunSettled,
}: {
  columns: MultiAgentColumn[];
  activeRunId: string | null;
  expandedFindingId: string | null;
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  onSelect: (runId: string) => void;
  onOpenTrace: (runId: string) => void;
  onRunSettled?: () => void;
}) {
  const t = useTranslations("multiAgent");
  const action = useFindingAction();
  const active = columns.find((c) => c.run_id === activeRunId) ?? columns[0];
  if (!active) return null;
  const id = agentIdentity(active.agent_id, active.agent_name);

  const tabs = columns.map((c) => ({
    key: c.run_id,
    label: c.agent_name ?? "—",
    icon: agentIdentity(c.agent_id, c.agent_name).icon,
    ...(c.status === "done" && c.score != null ? { count: c.score, countColor: scoreColor(c.score) } : {}),
  }));

  return (
    <div style={s.root}>
      <Tabs tabs={tabs} value={active.run_id} onChange={onSelect} pad="0" />
      <div style={s.body}>
        <div style={s.summary(id.color)}>
          {active.status === "done" && active.score != null && (
            <CircularScore score={active.score} size={44} />
          )}
          <div style={s.summaryMain}>
            <span style={s.summaryName(id.color)}>{active.agent_name ?? "—"}</span>
            {active.status === "done" && active.summary && (
              <span style={s.summaryText}>{active.summary}</span>
            )}
            {(active.status === "failed" || active.status === "cancelled") && (
              <span style={s.error}>{active.error ?? t(`status.${active.status}`)}</span>
            )}
            {active.status === "running" && <span style={s.meta}>{t("status.running")}</span>}
          </div>
          <div style={s.summarySide}>
            <Button kind="ghost" size="sm" onClick={() => onOpenTrace(active.run_id)}>
              {t("results.viewTrace")}
            </Button>
            {active.status !== "running" && (
              <span style={s.meta}>
                {formatDurationEstimate(active.duration_ms) ?? "—"} · {formatUsd(active.cost_usd)}
              </span>
            )}
          </div>
        </div>

        {active.status === "running" && (
          <LiveRunLog
            key={active.run_id}
            runId={active.run_id}
            height={COLUMN_LOG_HEIGHT * 2}
            onSettled={onRunSettled}
          />
        )}
        {active.status === "done" &&
          active.findings.map((f) => (
            <FindingCard
              key={f.id}
              f={f}
              showLearn
              focused={f.id === expandedFindingId}
              defaultExpanded={f.id === expandedFindingId}
              pending={action.isPending && action.variables?.findingId === f.id}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(kind) => action.mutate({ findingId: f.id, action: kind, prId })}
            />
          ))}
        {active.status === "done" && active.findings.length === 0 && (
          <div style={s.muted}>{t("results.noFindings")}</div>
        )}
      </div>
    </div>
  );
}
