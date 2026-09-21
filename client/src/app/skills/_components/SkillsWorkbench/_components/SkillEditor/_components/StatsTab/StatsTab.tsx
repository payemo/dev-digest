/* StatsTab — USED BY / PULL FREQUENCY / FINDINGS / ACCEPT RATE metric tiles,
   plus a findings-by-category breakdown. All attribution runs through
   run_skills (see server/src/modules/skills/repository.ts): the numbers cover
   runs this skill was actually injected into, not findings it caused. */
"use client";

import { useTranslations } from "next-intl";
import { MetricCard, BarRow, Skeleton, ErrorState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../../../../../lib/hooks/skills";
import { CATEGORY_COLORS } from "./constants";
import { fmtPct } from "./helpers";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const dash = t("editor.stats.dash");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <div style={s.metricsRow}>
          <Skeleton height={90} />
          <Skeleton height={90} />
          <Skeleton height={90} />
          <Skeleton height={90} />
        </div>
      </div>
    );
  }
  if (isError || !stats) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  const maxCategory = Math.max(1, ...stats.by_category.map((c) => c.count));

  return (
    <div style={s.wrap}>
      <div style={s.metricsRow}>
        <div style={s.metricCol}>
          <MetricCard
            label={t("editor.stats.usedBy")}
            value={t("editor.stats.usedByAgents", { count: stats.used_by_agents })}
          />
        </div>
        <div style={s.metricCol}>
          <MetricCard label={t("editor.stats.pullFrequency")} value={fmtPct(stats.pull_frequency_pct, dash)} />
          {stats.pull_frequency_pct != null && (
            <span style={s.metricCaption}>
              {t("editor.stats.pullFrequencyValue", {
                injected: stats.injected_runs,
                total: stats.linked_agent_runs,
              })}
            </span>
          )}
        </div>
        <div style={s.metricCol}>
          <MetricCard label={t("editor.stats.findings", { days: stats.window_days })} value={stats.findings} />
        </div>
        <div style={s.metricCol}>
          <MetricCard label={t("editor.stats.acceptRate")} value={fmtPct(stats.accept_rate, dash)} />
          {stats.accept_rate != null && (
            <span style={s.metricCaption}>
              {t("editor.stats.acceptRateValue", {
                accepted: stats.accepted,
                triaged: stats.accepted + stats.dismissed,
              })}
            </span>
          )}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>{t("editor.stats.byCategory")}</div>
        {stats.by_category.length === 0 ? (
          <div style={s.empty}>{t("editor.stats.none")}</div>
        ) : (
          stats.by_category.map((c, i) => (
            <BarRow
              key={c.category}
              label={c.category}
              value={c.count}
              max={maxCategory}
              color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
              suffix={String(c.count)}
            />
          ))
        )}
        <div style={s.note}>{t("editor.stats.correlationNote")}</div>
      </div>
    </div>
  );
}
