/* ResultsHeader — Multi-Agent Review results header: title + agent count,
   Configure run / New multi-agent run, the Columns/Tabs switch, the PR, the
   overall status and the totals (failed-run cost shown separately). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { MultiAgentRunView } from "@devdigest/shared";
import { formatDurationEstimate, formatUsd } from "@/lib/format";
import { STATUS_COLOR, type ResultView } from "../../constants";
import { s } from "./styles";

export function ResultsHeader({
  view,
  mode,
  onMode,
  onConfigure,
  onNewRun,
}: {
  view: MultiAgentRunView;
  mode: ResultView;
  onMode: (mode: ResultView) => void;
  onConfigure: () => void;
  onNewRun: () => void;
}) {
  const t = useTranslations("multiAgent");
  const color = STATUS_COLOR[view.status] ?? "var(--text-muted)";

  return (
    <header style={s.root}>
      <div style={s.row}>
        <Button kind="secondary" size="sm" icon="Settings" onClick={onConfigure}>
          {t("results.configureRun")}
        </Button>
        <h1 style={s.title}>{t("results.title")}</h1>
        <span style={s.sub}>{t("results.selected", { count: view.agent_count })}</span>
        <span style={s.spacer} />
        <Button kind="primary" size="sm" icon="Plus" onClick={onNewRun}>
          {t("results.newRun")}
        </Button>
        <div style={s.modes} role="group">
          <Button
            kind="tertiary"
            size="sm"
            active={mode === "columns"}
            aria-pressed={mode === "columns"}
            onClick={() => onMode("columns")}
          >
            {t("results.columns")}
          </Button>
          <Button
            kind="tertiary"
            size="sm"
            active={mode === "tabs"}
            aria-pressed={mode === "tabs"}
            onClick={() => onMode("tabs")}
          >
            {t("results.tabs")}
          </Button>
        </div>
      </div>
      <div style={s.row}>
        <span style={s.pr}>
          <span className="mono" style={s.prNumber}>
            #{view.pr_number}
          </span>
          <span style={s.prTitle}>{view.pr_title}</span>
        </span>
        <Badge color={color} dot>
          {t(`status.${view.status}`)}
        </Badge>
        <span style={s.spacer} />
        <span style={s.totals} data-testid="results-totals">
          <span>
            {t("results.totals", {
              count: view.agent_count,
              duration: formatDurationEstimate(view.total_duration_ms) ?? "—",
              cost: formatUsd(view.total_cost_usd),
            })}
          </span>
          {view.failed_cost_usd != null && (
            <span style={s.failed}>{t("results.failedCost", { cost: formatUsd(view.failed_cost_usd) })}</span>
          )}
        </span>
      </div>
    </header>
  );
}
