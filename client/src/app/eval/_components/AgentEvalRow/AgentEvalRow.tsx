/* AgentEvalRow — one dashboard row per agent with cases: name, model, last
   run version/time/pass (or "never run"), recall sparkline and
   RECALL / PREC / CITE. The whole row links to the agent's eval detail. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon, Sparkline } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { METRIC_COLOR } from "@/components/eval-metrics";
import { dateTimeLabel, pct } from "@/lib/eval-format";
import { s } from "./styles";

export function AgentEvalRow({ agent }: { agent: EvalAgentSummary }) {
  const t = useTranslations("eval");
  const latest = agent.latest;
  const metrics = [
    { label: t("dashboard.short.recall"), value: latest?.recall ?? null, color: METRIC_COLOR.recall },
    { label: t("dashboard.short.precision"), value: latest?.precision ?? null, color: METRIC_COLOR.precision },
    { label: t("dashboard.short.citation"), value: latest?.citation_accuracy ?? null, color: METRIC_COLOR.citation },
  ];
  return (
    <Link href={`/eval/${agent.agent_id}`} style={s.row} data-testid="agent-eval-row">
      <span style={s.icon}>
        <Icon.Cpu size={18} />
      </span>
      <div style={s.main}>
        <div style={s.nameRow}>
          <span style={s.name}>{agent.agent_name}</span>
          <Badge mono>{agent.model}</Badge>
          {agent.in_flight && <Badge color="var(--accent-text)" bg="var(--accent-bg)">{t("dashboard.runningBadge")}</Badge>}
        </div>
        <div style={s.sub}>
          {latest
            ? t("dashboard.lastRun", {
                version: latest.agent_version,
                time: dateTimeLabel(latest.started_at),
                passed: latest.passed,
                total: latest.cases_total,
              })
            : t("dashboard.neverRun")}
        </div>
      </div>
      <div style={s.spark}>
        {agent.recall_series.length >= 2 && <Sparkline data={agent.recall_series} color={METRIC_COLOR.recall} w={64} h={24} />}
      </div>
      {metrics.map((m) => (
        <div key={m.label} style={s.metric}>
          <div style={s.metricLabel}>{m.label}</div>
          <div className="tnum" style={{ ...s.metricValue, color: m.value == null ? "var(--text-muted)" : m.color }}>
            {pct(m.value)}
          </div>
        </div>
      ))}
      <Icon.ChevronRight size={16} style={s.chevron} />
    </Link>
  );
}
