/* ColumnsView — one read-only column per child run of the parent, side by
   side. Findings are navigation only (→ Tabs + detail); no actions here. */
"use client";

import React from "react";
import type { MultiAgentColumn } from "@devdigest/shared";
import { AgentColumn } from "./_components/AgentColumn";
import { s } from "./styles";

export function ColumnsView({
  columns,
  onOpenFinding,
  onOpenTrace,
  onRunSettled,
}: {
  columns: MultiAgentColumn[];
  onOpenFinding: (runId: string, findingId: string) => void;
  onOpenTrace: (runId: string) => void;
  onRunSettled?: () => void;
}) {
  return (
    <div style={s.grid}>
      {columns.map((c) => (
        <AgentColumn
          key={c.run_id}
          column={c}
          onOpenFinding={(findingId) => onOpenFinding(c.run_id, findingId)}
          onOpenTrace={() => onOpenTrace(c.run_id)}
          onRunSettled={onRunSettled}
        />
      ))}
    </div>
  );
}
