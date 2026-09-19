/* SeverityCounters — "N CRITICAL · N WARNING · N SUGGESTION" chips for ONE
   review run, sitting under that run's verdict banner. Clicking a chip filters
   the findings listed below it to that severity; clicking the active chip
   again clears back to "all". Severities with no findings are not shown. */
"use client";

import React from "react";
import { Chip, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";

const SEVERITIES: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export function SeverityCounters({
  counts,
  active,
  onSelect,
}: {
  counts: Record<Severity, number>;
  active: Severity | null;
  onSelect: (severity: Severity | null) => void;
}) {
  const present = SEVERITIES.filter((s) => counts[s] > 0);
  if (present.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      {present.map((severity) => {
        const tok = SEV[severity];
        return (
          <Chip
            key={severity}
            icon={tok.icon}
            color={tok.c}
            count={counts[severity]}
            active={active === severity}
            onClick={() => onSelect(active === severity ? null : severity)}
          >
            {tok.label.toUpperCase()}
          </Chip>
        );
      })}
    </div>
  );
}
