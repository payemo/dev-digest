/* AgentCard — one selectable agent on the Configure run screen: checkbox,
   identity icon/colour, name, a one-line description (the agent's latest
   summary on this PR, else its description) and its time/cost estimate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Icon } from "@devdigest/ui";
import type { MultiAgentCandidate } from "@devdigest/shared";
import { formatDurationEstimate } from "@/lib/format";
import { agentIdentity, formatCostEstimate } from "../../../../helpers";
import { s } from "./styles";

export function AgentCard({
  candidate,
  checked,
  onToggle,
}: {
  candidate: MultiAgentCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("multiAgent");
  const id = agentIdentity(candidate.agent_id, candidate.agent_name);
  const I = Icon[id.icon];
  const duration = formatDurationEstimate(candidate.estimate.avg_duration_ms);
  const cost = formatCostEstimate(candidate.estimate.avg_cost_usd);
  const hasEstimate = candidate.estimate.sample_size > 0 && duration != null && cost != null;
  // Untrusted LLM text (a review summary): rendered as plain text, one line.
  const line = candidate.latest_summary ?? candidate.description;

  return (
    <div
      data-testid="agent-card"
      style={s.card(checked, id.color, id.bg)}
      onClick={onToggle}
    >
      {/* The checkbox toggles via the card's click; stop it double-firing. */}
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={checked} onChange={onToggle} />
      </span>
      <span style={s.icon(id.color, id.bg)}>
        <I size={15} />
      </span>
      <div style={s.main}>
        <span style={s.name}>{candidate.agent_name}</span>
        {line && (
          <span style={s.description} title={line}>
            {line}
          </span>
        )}
      </div>
      <span style={s.estimate}>
        {hasEstimate
          ? t("configure.estimate", { duration, cost })
          : t("configure.noEstimate")}
      </span>
    </div>
  );
}
