/* ColumnsView — one column per child run of the parent, side by side. A
   finding opens Tabs + detail, and can be accepted / dismissed / turned into
   an eval case in place. */
"use client";

import React from "react";
import type { MultiAgentColumn } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";
import { AgentColumn } from "./_components/AgentColumn";
import { s } from "./styles";

export function ColumnsView({
  columns,
  prId,
  onOpenFinding,
  onOpenTrace,
  onRunSettled,
}: {
  columns: MultiAgentColumn[];
  prId: string;
  onOpenFinding: (runId: string, findingId: string) => void;
  onOpenTrace: (runId: string) => void;
  onRunSettled?: () => void;
}) {
  const action = useFindingAction();
  return (
    <div style={s.grid}>
      {columns.map((c) => (
        <AgentColumn
          key={c.run_id}
          column={c}
          onOpenFinding={(findingId) => onOpenFinding(c.run_id, findingId)}
          onOpenTrace={() => onOpenTrace(c.run_id)}
          onRunSettled={onRunSettled}
          pendingFindingId={action.isPending ? (action.variables?.findingId ?? null) : null}
          onAction={(findingId, kind) => action.mutate({ findingId, action: kind, prId })}
        />
      ))}
    </div>
  );
}
