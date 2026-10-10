/* RecentRunsTable — the window's runs, newest first, each with a checkbox;
   Compare is enabled iff exactly two runs are selected. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, SectionLabel } from "@devdigest/ui";
import type { EvalAgentRun } from "@devdigest/shared";
import { MetricBar, METRIC_COLOR } from "@/components/eval-metrics";
import { costLabel, dateTimeLabel } from "@/lib/eval-format";
import { s } from "./styles";

export function RecentRunsTable({
  runs,
  onCompare,
}: {
  runs: EvalAgentRun[];
  onCompare: (a: string, b: string) => void;
}) {
  const t = useTranslations("eval");
  const [selected, setSelected] = React.useState<string[]>([]);
  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => (on ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id)));
  const canCompare = selected.length === 2;

  return (
    <div>
      <SectionLabel
        icon="History"
        right={
          <Button
            kind="secondary"
            size="sm"
            icon="GitBranch"
            disabled={!canCompare}
            onClick={() => canCompare && onCompare(selected[0]!, selected[1]!)}
          >
            {t("detail.compare")}
          </Button>
        }
      >
        {t("detail.recentRuns")} <span style={s.hint}>{t("detail.selectTwo")}</span>
      </SectionLabel>
      {runs.length === 0 ? (
        <div style={s.empty}>{t("history.empty")}</div>
      ) : (
        <div style={s.table} role="table">
          <div style={{ ...s.row, ...s.head }} role="row">
            <span role="columnheader" />
            <span role="columnheader">{t("history.ranAt")}</span>
            <span role="columnheader">{t("history.version")}</span>
            <span role="columnheader">{t("history.recall")}</span>
            <span role="columnheader">{t("history.precision")}</span>
            <span role="columnheader">{t("history.citation")}</span>
            <span role="columnheader">{t("history.pass")}</span>
            <span role="columnheader">{t("history.cost")}</span>
          </div>
          {runs.map((r) => (
            <div key={r.id} style={s.row} role="row" data-testid="eval-run-row">
              <span role="cell">
                <Checkbox
                  checked={selected.includes(r.id)}
                  onChange={(on) => toggle(r.id, on)}
                  label={<span style={s.srOnly}>{t("detail.selectRun", { version: r.agent_version })}</span>}
                />
              </span>
              <span className="mono" style={s.time} role="cell">
                {dateTimeLabel(r.started_at)}
              </span>
              <span style={s.version} role="cell">
                v{r.agent_version}
              </span>
              <span role="cell">
                <MetricBar value={r.recall} color={METRIC_COLOR.recall} />
              </span>
              <span role="cell">
                <MetricBar value={r.precision} color={METRIC_COLOR.precision} />
              </span>
              <span role="cell">
                <MetricBar value={r.citation_accuracy} color={METRIC_COLOR.citation} />
              </span>
              <span className="tnum" style={s.pass} role="cell">
                {r.status === "completed" ? (
                  `${r.passed}/${r.cases_total}`
                ) : (
                  <span title={r.error ?? undefined}>
                    <Badge color={r.status === "failed" ? "var(--crit)" : "var(--accent)"} dot>
                      {t(`history.${r.status}`)}
                    </Badge>
                  </span>
                )}
              </span>
              <span className="tnum" role="cell">
                {costLabel(r.cost_usd)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
