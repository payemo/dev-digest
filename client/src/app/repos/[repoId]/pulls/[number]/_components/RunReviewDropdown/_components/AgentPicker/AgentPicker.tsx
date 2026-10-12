/* AgentPicker — the RunReviewDropdown popover body: one checkbox row per
   ENABLED agent with its time estimate, a multi-agent run button, "Run all
   enabled agents" and a link to the Configure run screen. Presentational: the
   dropdown owns the open state and the ticked selection. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon } from "@devdigest/ui";
import type { MultiAgentCandidate } from "@devdigest/shared";
import { formatDurationEstimate } from "@/lib/format";
import { s } from "./styles";

export function AgentPicker({
  candidates,
  loading,
  tickedIds,
  warnMerged,
  pending,
  onToggle,
  onClear,
  onRun,
  onRunAll,
  onConfigure,
  onOpenAgents,
}: {
  candidates: MultiAgentCandidate[];
  loading: boolean;
  tickedIds: string[];
  warnMerged: boolean;
  pending: boolean;
  onToggle: (agentId: string) => void;
  onClear: () => void;
  onRun: () => void;
  onRunAll: () => void;
  onConfigure: () => void;
  onOpenAgents: () => void;
}) {
  const t = useTranslations("prReview");
  const ticked = new Set(tickedIds);
  const none = !loading && candidates.length === 0;

  return (
    <div>
      {warnMerged && <div style={s.warn}>{t("runReview.mergedWarning")}</div>}
      <div style={s.head}>
        <span style={s.heading}>{t("runReview.pickAgents")}</span>
        <button type="button" style={s.clear} onClick={onClear} disabled={none}>
          {t("runReview.clear")}
        </button>
      </div>

      {loading && <div style={s.muted}>{t("runReview.loadingAgents")}</div>}
      {none && (
        <button type="button" style={s.link} onClick={onOpenAgents}>
          <Icon.Plus size={14} />
          {t("runReview.noAgents")}
        </button>
      )}
      <div style={s.list}>
        {candidates.map((c) => {
          const est = formatDurationEstimate(c.estimate.avg_duration_ms);
          return (
            <div key={c.agent_id} style={s.row}>
              <Checkbox
                checked={ticked.has(c.agent_id)}
                onChange={() => onToggle(c.agent_id)}
                label={<span style={s.name}>{c.agent_name}</span>}
              />
              <span style={s.estimate}>
                {est ? t("runReview.estimate", { duration: est }) : t("runReview.noEstimate")}
              </span>
            </div>
          );
        })}
      </div>

      <div style={s.divider} />
      <div style={s.actions}>
        <Button
          kind="primary"
          size="sm"
          icon="Users"
          full
          disabled={tickedIds.length === 0 || pending}
          onClick={onRun}
        >
          {t("runReview.runMulti", { count: tickedIds.length })}
        </Button>
        <Button kind="ghost" size="sm" icon="Play" full disabled={none || pending} onClick={onRunAll}>
          {t("runReview.runAll")}
        </Button>
      </div>
      <div style={s.divider} />
      <button type="button" style={s.link} onClick={onConfigure}>
        <Icon.Settings size={14} />
        {t("runReview.configureAgents")}
      </button>
    </div>
  );
}
