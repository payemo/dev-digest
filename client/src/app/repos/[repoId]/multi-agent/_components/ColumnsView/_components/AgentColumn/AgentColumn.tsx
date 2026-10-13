/* AgentColumn — one child run as a column: identity, status, duration/cost,
   score (done) or error (failed/cancelled), a live log while running, and a
   compact findings list: each item opens Tabs + detail and carries its own
   Accept / Dismiss / Learn / eval-case actions so a decision needs no
   navigation. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, Icon } from "@devdigest/ui";
import type { FindingActionKind, MultiAgentColumn } from "@devdigest/shared";
import { FindingActions } from "@/components/finding-actions";
import { formatDurationEstimate, formatUsd } from "@/lib/format";
import { SEVERITY_ICON, SEVERITY_ICON_FALLBACK, STATUS_COLOR } from "../../../../constants";
import { agentIdentity } from "../../../../helpers";
import { LiveRunLog } from "../../../LiveRunLog";
import { s } from "./styles";

export function AgentColumn({
  column,
  onOpenFinding,
  onOpenTrace,
  onRunSettled,
  onAction,
  pendingFindingId,
}: {
  column: MultiAgentColumn;
  onOpenFinding: (findingId: string) => void;
  onOpenTrace: () => void;
  onAction?: (findingId: string, action: FindingActionKind) => void;
  pendingFindingId?: string | null;
  onRunSettled?: () => void;
}) {
  const t = useTranslations("multiAgent");
  const id = agentIdentity(column.agent_id, column.agent_name);
  const I = Icon[id.icon];
  const running = column.status === "running";
  const done = column.status === "done";
  const duration = formatDurationEstimate(column.duration_ms);

  return (
    <section style={s.card(id.color)} aria-label={column.agent_name ?? column.run_id}>
      <div style={s.head}>
        <span style={s.icon(id.color, id.bg)}>
          <I size={14} />
        </span>
        <div style={s.headMain}>
          <span style={s.name}>{column.agent_name ?? "—"}</span>
          <span style={s.meta}>
            {running ? (
              <span style={s.status(STATUS_COLOR.running!)}>{t("status.running")}</span>
            ) : (
              <>
                <span style={s.status(STATUS_COLOR[column.status] ?? "var(--text-muted)")}>
                  {t(`status.${column.status}`)}
                </span>
                {" · "}
                {duration ?? "—"} · {formatUsd(column.cost_usd)}
              </>
            )}
          </span>
        </div>
        {done && column.score != null && <CircularScore score={column.score} size={36} stroke={3} />}
      </div>

      <div style={s.body}>
        {running && (
          <LiveRunLog
            runId={column.run_id}
            variant="bar"
            color={id.color}
            label={t("status.running")}
            onSettled={onRunSettled}
          />
        )}
        {!running && !done && column.error && <div style={s.error}>{column.error}</div>}
        {done &&
          column.findings.map((f) => {
            const sev = SEVERITY_ICON[f.severity] ?? SEVERITY_ICON_FALLBACK;
            const SevIcon = Icon[sev.icon];
            return (
              <div key={f.id} style={s.findingItem(f.accepted_at != null || f.dismissed_at != null)}>
                <button type="button" style={s.finding(sev.color)} onClick={() => onOpenFinding(f.id)}>
                  <span style={s.findingTitle}>
                    <SevIcon size={13} style={s.sevIcon(sev.color)} />
                    {f.title}
                  </span>
                  <span style={s.findingLoc}>
                    {f.file}:{f.start_line}
                  </span>
                </button>
                <FindingActions
                  f={f}
                  showLearn
                  marginTop={0}
                  pending={pendingFindingId === f.id}
                  onAction={(kind) => onAction?.(f.id, kind)}
                />
              </div>
            );
          })}
        {done && column.findings.length === 0 && <div style={s.muted}>{t("results.noFindings")}</div>}
      </div>

      {!running && (
        <div style={s.foot}>
          <Button kind="ghost" size="sm" onClick={onOpenTrace}>
            {t("results.viewTrace")}
          </Button>
          {done && column.findings.length > 0 && (
            <span>{t("results.findings", { count: column.findings.length })}</span>
          )}
        </div>
      )}
    </section>
  );
}
