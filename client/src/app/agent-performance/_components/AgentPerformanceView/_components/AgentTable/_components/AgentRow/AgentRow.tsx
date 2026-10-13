/* AgentRow — one agent's table row plus its expandable detail row. Everything
   shown comes from the loaded row: expanding never fetches. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { AgentStats } from "@devdigest/shared";
import { formatDurationEstimate, formatUsd } from "@/lib/format";
import { AcceptCell } from "./_components/AcceptCell";
import { RowDetails } from "./_components/RowDetails";
import { relativeAgo } from "./helpers";
import { s } from "./styles";

export function AgentRow({
  row,
  now,
  minDecisions,
  periodQuery,
  open,
  onToggle,
}: {
  row: AgentStats;
  now: number;
  minDecisions: number;
  periodQuery: string;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("agentPerformance");
  const detailsId = `agent-details-${row.agent_id}`;
  const hasRuns = row.runs > 0;
  const ago = relativeAgo(row.last_run_at, now);
  const href = `/agents/${row.agent_id}?tab=stats&${periodQuery}`;

  // A click anywhere on the row toggles it, except on its own controls.
  const onRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    onToggle();
  };

  return (
    <>
      <tr style={s.row} onClick={onRowClick}>
        <td style={s.td}>
          <button
            type="button"
            style={s.agentBtn}
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={t("table.expand.toggle", { name: row.agent_name })}
          >
            <span style={s.agentIcon}>
              <Icon.Cpu size={14} />
            </span>
            <span>
              {row.agent_name}
              {!hasRuns && <span style={s.agentSub}>{t("table.noRuns")}</span>}
              {hasRuns && !row.enabled && <span style={s.agentSub}>{t("table.disabled")}</span>}
            </span>
          </button>
        </td>
        <td style={s.num}>{hasRuns ? row.runs : <Dash />}</td>
        <td style={s.num}>{hasRuns ? formatUsd(row.avg_cost_usd) : <Dash />}</td>
        <td style={s.num}>{hasRuns ? (formatDurationEstimate(row.avg_latency_ms) ?? "—") : <Dash />}</td>
        <td style={s.td}>
          {hasRuns ? <AcceptCell row={row} minDecisions={minDecisions} /> : <Dash />}
        </td>
        <td style={s.lastRun}>
          {ago ? (ago.unit === "justNow" ? t("table.ago.justNow") : t(`table.ago.${ago.unit}`, { n: ago.n })) : "—"}
        </td>
        <td style={s.td}>
          <Link href={href} style={s.view} aria-label={t("table.viewAgent", { name: row.agent_name })}>
            {t("table.view")}
          </Link>
        </td>
      </tr>
      {open && (
        <tr id={detailsId}>
          <td colSpan={7} style={s.details}>
            <RowDetails row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function Dash() {
  return <span style={s.muted}>—</span>;
}
