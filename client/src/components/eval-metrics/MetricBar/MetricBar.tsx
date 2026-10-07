/* MetricBar — a metric as a bar + "82%" (or "—" with an empty bar when not
   applicable), for the run tables on the dashboard and the agent detail page. */
"use client";

import React from "react";
import { ProgressBar } from "@devdigest/ui";
import { pct } from "@/lib/eval-format";
import { s } from "../styles";

export function MetricBar({ value, color }: { value: number | null; color: string }) {
  return (
    <div style={s.bar}>
      <div style={s.barTrack}>
        <ProgressBar value={value == null ? 0 : value * 100} color={color} />
      </div>
      <span className="mono tnum" style={s.barLabel}>
        {pct(value)}
      </span>
    </div>
  );
}
