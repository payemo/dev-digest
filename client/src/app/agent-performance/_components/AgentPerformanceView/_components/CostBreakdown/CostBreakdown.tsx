/* CostBreakdown — "Cost breakdown · Estimated": cost by agent and by model.
   Both come from the same per-run cost list as the Total cost card, so each
   sums to it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { AgentPerformance, CostSlice } from "@devdigest/shared";
import { CostDonut, type CostDonutSlice } from "../CostDonut";
import { DELETED_AGENT_KEY, SLICE_COLORS, UNKNOWN_MODEL_KEY } from "./constants";
import { s } from "./styles";

function toDonut(slices: CostSlice[], labelFor: (sl: CostSlice) => string): CostDonutSlice[] {
  return slices.map((sl, i) => ({
    key: sl.key,
    label: labelFor(sl),
    costUsd: sl.cost_usd,
    color: SLICE_COLORS[i % SLICE_COLORS.length]!,
  }));
}

export function CostBreakdown({ data }: { data: AgentPerformance }) {
  const t = useTranslations("agentPerformance");
  const total = data.totals.total_cost_usd;
  const byAgent = toDonut(data.cost_by_agent, (sl) =>
    sl.key === DELETED_AGENT_KEY ? t("cost.deletedAgent") : sl.label,
  );
  const byModel = toDonut(data.cost_by_model, (sl) =>
    sl.key === UNKNOWN_MODEL_KEY ? t("cost.unknownModel") : sl.label,
  );

  return (
    <section style={s.section} aria-label={t("cost.title")}>
      <div style={s.header}>
        <Icon.DollarSign size={13} />
        {t("cost.title")} · {t("cost.estimated")}
      </div>
      <div style={s.grid}>
        <div style={s.card}>
          <span style={s.cardTitle}>{t("cost.byAgent")}</span>
          <CostDonut slices={byAgent} total={total} />
        </div>
        <div style={s.card}>
          <span style={s.cardTitle}>{t("cost.byModel")}</span>
          <CostDonut slices={byModel} total={total} />
        </div>
      </div>
    </section>
  );
}
