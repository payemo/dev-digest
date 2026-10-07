/* EvalMetricTiles — recall / precision / citation tiles (+ optional traces
   passed) for the latest completed eval run, each with its signed delta vs the
   run before. A not-applicable metric shows "—" with no delta; with no
   completed run at all, an explicit empty state is shown instead of zeros. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, MetricCard } from "@devdigest/ui";
import type { EvalAgentRun, EvalMetricTriple, EvalTrendPoint } from "@devdigest/shared";
import { pctNumber } from "@/lib/eval-format";
import { METRIC_COLOR, s } from "../styles";

type MetricKey = "recall" | "precision" | "citation_accuracy";

const TILES: { key: MetricKey; labelKey: string; color: string }[] = [
  { key: "recall", labelKey: "tiles.recall", color: METRIC_COLOR.recall },
  { key: "precision", labelKey: "tiles.precision", color: METRIC_COLOR.precision },
  { key: "citation_accuracy", labelKey: "tiles.citation", color: METRIC_COLOR.citation },
];

/** A metric's trend series with not-applicable points skipped (≥ 2 points to draw). */
function series(trend: EvalTrendPoint[] | undefined, key: MetricKey): number[] | undefined {
  const values = (trend ?? []).map((p) => p[key]).filter((v): v is number => v != null);
  return values.length >= 2 ? values : undefined;
}

export function EvalMetricTiles({
  latest,
  delta,
  trend,
  showTracesPassed,
}: {
  latest: EvalAgentRun | null;
  delta: EvalMetricTriple;
  trend?: EvalTrendPoint[];
  showTracesPassed?: boolean;
}) {
  const t = useTranslations("eval");
  if (!latest) {
    return (
      <div style={s.empty}>
        <EmptyState icon="Gauge" title={t("tiles.empty")} body={t("tiles.emptyBody")} />
      </div>
    );
  }
  return (
    <div style={s.tiles}>
      {TILES.map((tile) => {
        const value = pctNumber(latest[tile.key]);
        const d = value == null ? null : delta[tile.key];
        return (
          <div key={tile.key} style={s.tile} data-testid={`eval-tile-${tile.key}`}>
            <MetricCard
              label={t(tile.labelKey)}
              value={value ?? "—"}
              {...(value != null ? { suffix: "%" } : {})}
              {...(d != null ? { delta: d } : {})}
              color={tile.color}
              trend={series(trend, tile.key)}
            />
          </div>
        );
      })}
      {showTracesPassed && (
        <div style={s.tile} data-testid="eval-tile-traces">
          <MetricCard label={t("tiles.tracesPassed")} value={`${latest.passed}/${latest.cases_total}`} />
        </div>
      )}
    </div>
  );
}
