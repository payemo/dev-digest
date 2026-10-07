/* RunProgress — "k / n cases" + a progress bar for an eval run, plus one
   pass / fail / errored icon per case result as each one finishes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, ProgressBar } from "@devdigest/ui";
import type { EvalAgentRun, EvalCaseResult } from "@devdigest/shared";
import { s } from "../styles";

const STATUS_ICON = {
  passed: { icon: "CheckCircle", color: "var(--ok)" },
  failed: { icon: "XCircle", color: "var(--crit)" },
  errored: { icon: "AlertTriangle", color: "var(--warn)" },
} as const;

export function RunProgress({
  run,
  results,
}: {
  run: Pick<EvalAgentRun, "cases_done" | "cases_total" | "status" | "error">;
  results?: EvalCaseResult[];
}) {
  const t = useTranslations("eval");
  const pctDone = run.cases_total > 0 ? (run.cases_done / run.cases_total) * 100 : 0;
  return (
    <div style={s.progress} aria-live="polite">
      <div style={s.progressRow}>
        {run.status === "running" && <Icon.RefreshCw size={13} style={{ animation: "ddspin 1s linear infinite" }} />}
        <span style={s.progressCount}>
          {t("progress.cases", { done: run.cases_done, total: run.cases_total })}
        </span>
      </div>
      <ProgressBar value={pctDone} />
      {results && results.length > 0 && (
        <div style={s.icons}>
          {results.map((r) => {
            const meta = STATUS_ICON[r.status];
            const I = Icon[meta.icon];
            return (
              <span key={r.id} title={`${r.case_name} · ${r.status}`}>
                <I size={13} style={{ color: meta.color }} aria-label={`${r.case_name}: ${r.status}`} />
              </span>
            );
          })}
        </div>
      )}
      {run.status === "failed" && run.error && (
        <div style={s.failed}>{t("progress.failed", { error: run.error })}</div>
      )}
    </div>
  );
}
