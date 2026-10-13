/* RowDetails — the expanded row's decision breakdown. Everything below comes
   from the loaded row — expanding never fetches. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentStats } from "@devdigest/shared";
import { formatRatePct } from "@/components/stats-period";
import { s } from "./styles";

export function RowDetails({ row }: { row: AgentStats }) {
  const t = useTranslations("agentPerformance");
  const items: [string, React.ReactNode][] = [
    [t("table.expand.accepted"), row.accepted],
    [t("table.expand.dismissed"), row.dismissed],
    [t("table.expand.pending"), row.pending],
    [t("table.expand.failedRuns"), row.failed_runs],
    [t("table.expand.unpricedRuns"), row.unpriced_runs],
    [
      t("table.expand.bySeverity"),
      `${row.findings_by_severity.CRITICAL} / ${row.findings_by_severity.WARNING} / ${row.findings_by_severity.SUGGESTION}`,
    ],
    [
      t("table.expand.previousRate"),
      t("table.expand.previousRateValue", {
        rate: formatRatePct(row.previous.accept_rate),
        decisions: row.previous.decisions,
      }),
    ],
  ];
  return (
    <dl style={s.detailGrid}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt style={s.dt}>{label}</dt>
          <dd style={s.dd}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
