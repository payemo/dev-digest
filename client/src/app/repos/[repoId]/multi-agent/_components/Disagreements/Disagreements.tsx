/* Disagreements — "Where agents disagree": one row per grouped location, one
   cell per column of this run (flagged / did not flag / no result / pending),
   with a "Show only conflicts" toggle. Not rendered with fewer than 2 columns. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, Toggle, type Severity } from "@devdigest/ui";
import type { DisagreementRow, DisagreementTake, MultiAgentColumn } from "@devdigest/shared";
import { TAKE_META } from "./constants";
import { visibleRows } from "./helpers";
import { s } from "./styles";

export function Disagreements({
  rows,
  columns,
}: {
  rows: DisagreementRow[];
  columns: MultiAgentColumn[];
}) {
  const t = useTranslations("multiAgent");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  if (columns.length < 2) return null;

  const names = new Map(columns.map((c) => [c.run_id, c.agent_name ?? "—"]));
  const noneDone = !columns.some((c) => c.status === "done");
  const shown = visibleRows(rows, onlyConflicts);

  return (
    <section style={s.root} aria-label={t("disagree.title")}>
      <div style={s.head}>
        <span style={s.heading}>
          <Icon.Activity size={13} />
          {t("disagree.title")}
        </span>
        <label style={s.toggle}>
          {t("disagree.onlyConflicts")}
          <Toggle on={onlyConflicts} onChange={setOnlyConflicts} />
        </label>
      </div>

      {noneDone && rows.length === 0 && <div style={s.empty}>{t("disagree.allFailed")}</div>}
      {!noneDone && shown.length === 0 && <div style={s.empty}>{t("disagree.noRows")}</div>}

      {shown.map((r) => (
        <div key={r.group_id} style={s.row} data-testid="disagreement-row">
          <div style={s.rowHead}>
            <Icon.Code size={13} />
            <span style={s.loc}>
              {r.file}:{r.line}
            </span>
            <span style={s.title}>{r.title}</span>
          </div>
          <div style={s.cells}>
            {r.takes.map((take) => (
              <TakeCell key={take.run_id} take={take} agentName={names.get(take.run_id) ?? "—"} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function TakeCell({ take, agentName }: { take: DisagreementTake; agentName: string }) {
  const t = useTranslations("multiAgent");
  if (take.kind === "flagged") {
    return (
      <div style={s.cell} data-take={take.kind}>
        <span style={s.agent}>{agentName}</span>
        <SeverityBadge severity={take.severity as Severity} compact />
        {/* Untrusted model text: plain text only. */}
        <span style={s.note}>{take.note}</span>
      </div>
    );
  }
  const meta = TAKE_META[take.kind];
  return (
    <div style={s.cell} data-take={take.kind}>
      <span style={s.agent}>{agentName}</span>
      <span style={s.kind(meta.color)}>
        <span style={s.dot(meta.dot)} />
        {t(meta.labelKey)}
      </span>
      <span style={s.note}>{t(meta.noteKey)}</span>
    </div>
  );
}
