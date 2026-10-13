/* TrendArrow — accept-rate direction vs the previous period. Evidence-gated by
   the server: a null trend renders NO arrow, only a muted marker whose title
   says why, so an arrow is never invented from a small sample. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { AcceptTrend } from "@devdigest/shared";
import { s } from "./styles";

const ARROW = {
  up: { Glyph: Icon.ArrowUp, color: "var(--ok)" },
  down: { Glyph: Icon.ArrowDown, color: "var(--crit)" },
  flat: { Glyph: Icon.Slash, color: "var(--text-muted)" },
} as const;

export function TrendArrow({
  trend,
  deltaPp,
  minDecisions,
}: {
  trend: AcceptTrend | null;
  deltaPp: number | null;
  /** The server's ranking threshold, when the caller has it. */
  minDecisions?: number | null;
}) {
  const t = useTranslations("agentPerformance");
  if (trend === null || deltaPp === null) {
    const why =
      minDecisions != null
        ? t("trend.unavailable", { min: minDecisions })
        : t("trend.unavailableNoMin");
    return (
      <span style={s.noArrow} title={why} aria-label={why} data-testid="trend-unavailable">
        ·
      </span>
    );
  }
  const { Glyph, color } = ARROW[trend];
  const delta = deltaPp > 0 ? `+${deltaPp}` : String(deltaPp);
  const label = t(`trend.${trend}`, { delta });
  return (
    <span role="img" style={s.arrow(color)} title={label} aria-label={label}>
      <Glyph size={12} />
    </span>
  );
}
