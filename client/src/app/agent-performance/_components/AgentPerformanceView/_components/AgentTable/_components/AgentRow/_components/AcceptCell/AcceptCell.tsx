/* AcceptCell — the accept rate with its decision count, an evidence-gated trend
   arrow and a low-sample badge. A low-sample rate is never coloured. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { AgentStats } from "@devdigest/shared";
import { TrendArrow, formatRatePct, ratePct } from "@/components/stats-period";
import { acceptColor } from "./helpers";
import { s } from "./styles";

export function AcceptCell({ row, minDecisions }: { row: AgentStats; minDecisions: number }) {
  const t = useTranslations("agentPerformance");
  const pct = row.accept_rate === null ? null : ratePct(row.accept_rate);
  return (
    <span style={s.accept}>
      <span className="tnum" style={s.acceptPct(pct === null ? null : acceptColor(row, pct))}>
        {formatRatePct(row.accept_rate)}
      </span>
      <TrendArrow trend={row.accept_trend} deltaPp={row.accept_rate_delta_pp} minDecisions={minDecisions} />
      <span style={s.n}>{t("table.decisions", { count: row.decisions })}</span>
      {row.low_sample && (
        <span title={t("table.lowSampleHint", { min: minDecisions })}>
          <Badge color="var(--warn)" bg="var(--warn-bg)">
            {t("table.lowSample")}
          </Badge>
        </span>
      )}
    </span>
  );
}
