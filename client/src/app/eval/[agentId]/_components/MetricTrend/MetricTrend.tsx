/* MetricTrend — recall / precision / citation over the window's completed
   runs, oldest → newest. Built on recharts directly (not the vendored
   LineChart) because that primitive plots a missing value as 0, while a
   not-applicable metric must be skipped, never drawn as zero. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionLabel } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared";
import { METRIC_COLOR } from "@/components/eval-metrics";
import { s } from "./styles";

export function MetricTrend({ trend }: { trend: EvalTrendPoint[] }) {
  const t = useTranslations("eval");
  const series = [
    { key: "recall", label: t("dashboard.legend.recall"), color: METRIC_COLOR.recall },
    { key: "precision", label: t("dashboard.legend.precision"), color: METRIC_COLOR.precision },
    { key: "citation_accuracy", label: t("dashboard.legend.citation"), color: METRIC_COLOR.citation },
  ] as const;
  const rows = trend.map((p, i) => ({
    i,
    version: `v${p.version}`,
    recall: p.recall,
    precision: p.precision,
    citation_accuracy: p.citation_accuracy,
  }));
  return (
    <div style={s.card}>
      <SectionLabel
        icon="TrendingUp"
        right={
          <div style={s.legend}>
            {series.map((se) => (
              <span key={se.key} style={s.legendItem}>
                <span style={s.swatch(se.color)} />
                {se.label}
              </span>
            ))}
          </div>
        }
      >
        {t("detail.metricTrend")}
      </SectionLabel>
      {rows.length === 0 ? (
        <div style={s.empty}>{t("detail.trendEmpty")}</div>
      ) : (
        <div style={s.chart} data-testid="eval-metric-trend">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 14, bottom: 4, left: -10 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="version" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis
                domain={[0, 1]}
                tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                tickFormatter={(v: number) => v.toFixed(1)}
                axisLine={false}
                tickLine={false}
                width={38}
              />
              <Tooltip formatter={(v: number) => `${Math.round(v * 100)}%`} />
              {series.map((se) => (
                <Line
                  key={se.key}
                  type="monotone"
                  dataKey={se.key}
                  name={se.label}
                  stroke={se.color}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
