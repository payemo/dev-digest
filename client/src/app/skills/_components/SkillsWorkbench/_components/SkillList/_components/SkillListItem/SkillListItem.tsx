/* SkillListItem — name, type badge, source badge, enabled toggle, delete
   button, linked-agent count, and a "needs vetting" pill for an unvetted
   (non-manual-source, disabled) skill. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillAgents, useUpdateSkill, useDeleteSkill } from "../../../../../../../../lib/hooks/skills";
import { typeColor } from "./helpers";
import { s } from "./styles";

export function SkillListItem({
  skill,
  active,
  onClick,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const { data: agents } = useSkillAgents(skill.id);
  const agentCount = agents?.length;
  const needsVetting = skill.source !== "manual" && !skill.enabled;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmMsg =
      agentCount == null
        ? t("listItem.deleteConfirmUnknown", { name: skill.name })
        : t("listItem.deleteConfirm", { name: skill.name, count: agentCount });
    if (window.confirm(confirmMsg)) del.mutate(skill.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      style={s.card(!!active, skill.enabled)}
    >
      <div style={s.headerRow}>
        <span style={s.name}>{skill.name}</span>
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
            size={14}
          />
        </div>
        <button
          onClick={handleDelete}
          disabled={del.isPending}
          title={t("listItem.deleteLabel")}
          aria-label={t("listItem.deleteLabel")}
          style={s.deleteBtn(del.isPending)}
        >
          <Icon.Trash size={14} />
        </button>
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.metaRow}>
        <Badge color={typeColor(skill.type)}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-secondary)">{t(`listItem.source.${skill.source}`)}</Badge>
        {agentCount != null && (
          <Badge color="var(--text-secondary)" icon="Users">
            {t("listItem.agentCount", { count: agentCount })}
          </Badge>
        )}
        {needsVetting && (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        )}
      </div>
    </div>
  );
}
