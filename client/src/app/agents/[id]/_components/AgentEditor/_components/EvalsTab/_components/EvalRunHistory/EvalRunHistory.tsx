/* EvalRunHistory — the agent's full eval runs, newest first: version, time,
   the three metrics, pass x/y, cost and status (a run cut off by a restart
   shows as failed). Single-case runs never appear here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SectionLabel, Skeleton } from "@devdigest/ui";
import type { EvalAgentRun } from "@devdigest/shared";
import { costLabel, dateTimeLabel, pct } from "@/lib/eval-format";
import { s } from "./styles";

const STATUS_COLOR = {
  completed: "var(--ok)",
  failed: "var(--crit)",
  running: "var(--accent)",
} as const;

export function EvalRunHistory({ runs, loading }: { runs: EvalAgentRun[]; loading: boolean }) {
  const t = useTranslations("eval");
  return (
    <div>
      <SectionLabel icon="History">{t("history.heading")}</SectionLabel>
      {loading ? (
        <Skeleton height={80} />
      ) : runs.length === 0 ? (
        <div style={s.empty}>{t("history.empty")}</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t("history.version")}</th>
              <th style={s.th}>{t("history.ranAt")}</th>
              <th style={s.th}>{t("history.recall")}</th>
              <th style={s.th}>{t("history.precision")}</th>
              <th style={s.th}>{t("history.citation")}</th>
              <th style={s.th}>{t("history.pass")}</th>
              <th style={s.th}>{t("history.cost")}</th>
              <th style={s.th}>{t("history.status")}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td style={{ ...s.td, color: "var(--accent-text)" }}>v{r.agent_version}</td>
                <td className="mono" style={s.td}>
                  {dateTimeLabel(r.started_at)}
                </td>
                <td style={s.td}>{pct(r.recall)}</td>
                <td style={s.td}>{pct(r.precision)}</td>
                <td style={s.td}>{pct(r.citation_accuracy)}</td>
                <td style={s.td}>
                  {r.passed}/{r.cases_total}
                </td>
                <td style={s.td}>{costLabel(r.cost_usd)}</td>
                <td style={s.td}>
                  <span title={r.error ?? undefined}>
                    <Badge color={STATUS_COLOR[r.status]} dot>
                      {t(`history.${r.status}`)}
                    </Badge>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
