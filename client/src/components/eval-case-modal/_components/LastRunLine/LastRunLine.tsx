/* LastRunLine — "Last run passed · expected N finding(s), got M · 1.8s · $0.02"
   (or "Last run errored · <reason>"). For must_not_flag, N is 0 and M counts
   grounded findings at the forbidden location. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalCaseResult } from "@devdigest/shared";
import { costLabel, durationLabel } from "@/lib/eval-format";
import { s } from "./styles";

export function LastRunLine({ result }: { result: EvalCaseResult }) {
  const t = useTranslations("eval");
  const I = result.status === "passed" ? Icon.CheckCircle : result.status === "failed" ? Icon.XCircle : Icon.AlertTriangle;
  const text =
    result.status === "errored"
      ? t("modal.lastRunErrored", { reason: result.reason ?? "" })
      : t("modal.lastRun", {
          status: result.status === "passed" ? t("modal.statusPassed") : t("modal.statusFailed"),
          expected: result.expected_n,
          got: result.got_m,
          duration: durationLabel(result.duration_ms),
          cost: costLabel(result.cost_usd),
        });
  return (
    <div style={s.line(result.status)} role="status" data-testid="eval-last-run">
      <I size={15} style={s.icon(result.status)} />
      <span>{text}</span>
    </div>
  );
}
