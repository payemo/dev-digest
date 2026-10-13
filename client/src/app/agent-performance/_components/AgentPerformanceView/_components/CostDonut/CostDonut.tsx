/* CostDonut — page-local ring + legend on recharts. Exists because the vendored
   Donut prints every value as "$" + toFixed(2), which turns sub-cent review
   costs into "$0.00"; this one formats with formatUsd. A $0 slice keeps its
   legend row but draws no arc; a null/zero total replaces the ring. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Cell, Pie, PieChart } from "recharts";
import { formatUsd } from "@/lib/format";
import { s } from "./styles";

export interface CostDonutSlice {
  key: string;
  label: string;
  costUsd: number;
  color: string;
}

const SIZE = 130;
const STROKE = 22;

export function CostDonut({ slices, total }: { slices: CostDonutSlice[]; total: number | null }) {
  const t = useTranslations("agentPerformance");
  const arcs = slices.filter((sl) => sl.costUsd > 0);
  const hasCost = total !== null && total > 0 && arcs.length > 0;

  return (
    <div style={s.wrap}>
      {hasCost ? (
        <PieChart width={SIZE} height={SIZE}>
          <Pie
            data={arcs}
            dataKey="costUsd"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={(SIZE - STROKE) / 2 - STROKE / 2}
            outerRadius={(SIZE - STROKE) / 2 + STROKE / 2}
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
            stroke="none"
          >
            {arcs.map((sl) => (
              <Cell key={sl.key} fill={sl.color} />
            ))}
          </Pie>
        </PieChart>
      ) : (
        <div style={s.none}>{t("cost.none")}</div>
      )}
      <div style={s.legendCol}>
        <ul style={s.legend}>
          {slices.map((sl) => (
            <li key={sl.key} style={s.item}>
              <span style={s.swatch(sl.color)} />
              <span style={s.label} title={sl.label}>
                {sl.label}
              </span>
              <span className="mono tnum" style={s.value}>
                {formatUsd(sl.costUsd)}
              </span>
            </li>
          ))}
        </ul>
        <div style={s.total}>
          <span className="mono tnum">{t("cost.total", { amount: formatUsd(total) })}</span>
        </div>
      </div>
    </div>
  );
}
