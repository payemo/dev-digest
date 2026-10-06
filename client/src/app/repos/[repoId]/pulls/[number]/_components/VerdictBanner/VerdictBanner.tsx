/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score.
   `verdict` may be null (the PR Brief with no review yet): then only the
   summary renders, under a neutral icon. `actions` sits top-right of the main
   column (the brief's stale marker + refresh). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, CircularScore } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";
import { formatTokensCompact, formatUsd } from "@/lib/format";
import { NEUTRAL_META, VERDICT_META } from "./constants";
import { s } from "./styles";

export function VerdictBanner({
  verdict,
  summary,
  score,
  agentName,
  costUsd = null,
  tokensIn = null,
  tokensOut = null,
  findingsCount = 0,
  blockers = 0,
  actions,
}: {
  verdict: Verdict | null;
  summary: string | null;
  score: number | null;
  findingsCount?: number;
  blockers?: number;
  agentName?: string | null;
  /** This run's cost + tokens (from the matching RunSummary); omitted when
   *  no run is linked (e.g. the seeded demo review has no run_id). */
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** Controls rendered top-right of the main column, before the score. */
  actions?: React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const m = verdict ? (VERDICT_META[verdict] ?? VERDICT_META.comment) : NEUTRAL_META;
  const VIcon = Icon[m.icon];
  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        {(verdict || actions) && (
          <div style={s.titleRow}>
            {verdict && (
              <>
                <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
                <Badge color="var(--text-secondary)">
                  {t("verdict.findingsCount", { count: findingsCount })}
                  {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
                </Badge>
                {agentName && (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
                    {agentName}
                  </Badge>
                )}
              </>
            )}
            {actions && <div style={s.actions}>{actions}</div>}
          </div>
        )}
        {summary && <p style={s.summary}>{summary}</p>}
        {costUsd != null && tokensIn != null && tokensOut != null && (
          <div className="tnum" style={s.usage}>
            {formatUsd(costUsd)} · {formatTokensCompact(tokensIn, tokensOut)}
          </div>
        )}
      </div>
      {score != null && (
        <div style={s.scoreCol}>
          <CircularScore score={score} size={52} stroke={5} />
          <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
        </div>
      )}
    </div>
  );
}
