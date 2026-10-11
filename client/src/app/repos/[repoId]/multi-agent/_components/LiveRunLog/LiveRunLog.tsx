/* LiveRunLog — live progress of ONE running child run. Each instance opens its
   own SSE subscription (useRunEvents([runId])), so lines from parallel agents
   never mix. Calls `onSettled` once the stream closes. `variant="log"` shows
   the full log stream (wide layouts); `variant="bar"` is the compact form for
   narrow columns — an indeterminate bar plus the latest event line. */
"use client";

import React from "react";
import { LiveLogStream, type LogLine } from "@devdigest/ui";
import { useRunEvents } from "@/lib/hooks/reviews";
import { s } from "./styles";

export function LiveRunLog({
  runId,
  height = 160,
  variant = "log",
  color = "var(--accent)",
  label,
  onSettled,
}: {
  runId: string;
  height?: number;
  variant?: "log" | "bar";
  /** Bar fill colour (`variant="bar"`). */
  color?: string;
  /** Accessible name for the bar (`variant="bar"`). */
  label?: string;
  onSettled?: () => void;
}) {
  const { events, running } = useRunEvents([runId]);
  const wasRunning = React.useRef(false);

  // Sync with the external SSE stream: when it closes, ask for a refetch so
  // the column flips to its persisted result without waiting for the poll.
  React.useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      onSettled?.();
    }
  }, [running, onSettled]);

  if (variant === "bar") {
    const latest = events.length > 0 ? events[events.length - 1]!.msg : null;
    return (
      <div style={s.bar}>
        <div role="progressbar" aria-label={label} aria-busy="true" style={s.track}>
          <div style={s.fill(color)} />
        </div>
        {latest && (
          <span style={s.latest} title={latest}>
            {latest}
          </span>
        )}
      </div>
    );
  }

  const log: LogLine[] = events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
  return <LiveLogStream log={log} running={running} height={height} />;
}
