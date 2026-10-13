/* AgentTable — one row per workspace agent: runs, avg cost, avg duration,
   accept rate (with its decision count, a low-sample flag and an
   evidence-gated trend arrow), last run and a View link to the agent's Stats
   tab on the same period. Sorting and row expansion are local — they never
   fetch. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { AgentStats } from "@devdigest/shared";
import { COLUMNS, DEFAULT_SORT } from "./constants";
import { sortRows, type SortDir, type SortKey } from "./helpers";
import { AgentRow } from "./_components/AgentRow";
import { s } from "./styles";

export function AgentTable({
  rows,
  minDecisions,
  periodQuery,
}: {
  rows: AgentStats[];
  minDecisions: number;
  /** Serialised period (`period=…[&from&to]`) the View link carries. */
  periodQuery: string;
}) {
  const t = useTranslations("agentPerformance");
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const sorted = sortRows(rows, sort.key, sort.dir);
  const now = Date.now();

  const onSort = (key: SortKey) =>
    setSort((cur) =>
      cur.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" },
    );
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div style={s.wrap}>
      <table style={s.table}>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.id}
                style={s.th}
                aria-sort={c.sort && sort.key === c.sort ? ariaSort(sort.dir) : undefined}
              >
                {c.sort ? (
                  <button
                    type="button"
                    style={s.sortBtn}
                    onClick={() => onSort(c.sort!)}
                    aria-label={t("table.sortBy", { column: t(c.labelKey) })}
                  >
                    {t(c.labelKey)}
                    {sort.key === c.sort &&
                      (sort.dir === "desc" ? <Icon.ArrowDown size={11} /> : <Icon.ArrowUp size={11} />)}
                  </button>
                ) : c.id === "view" ? null : (
                  t(c.labelKey)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <AgentRow
              key={row.agent_id}
              row={row}
              now={now}
              minDecisions={minDecisions}
              periodQuery={periodQuery}
              open={expanded.has(row.agent_id)}
              onToggle={() => toggle(row.agent_id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ariaSort(dir: SortDir): "ascending" | "descending" {
  return dir === "asc" ? "ascending" : "descending";
}
