/* SkillsTab — attach/detach/reorder the skills linked to this agent. Every
   gesture below computes the next full ordered id array and POSTs it in one
   call (useSetAgentSkills); the server recomputes `order` from array index,
   so the UI can never drift from what's stored. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, IconBtn, Skeleton, Toggle } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { moveId } from "./helpers";
import { s } from "./styles";

function SkillRow({
  skill,
  attached,
  disabledUp,
  disabledDown,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  skill: Skill;
  attached: boolean;
  disabledUp?: boolean;
  disabledDown?: boolean;
  onToggle: (on: boolean) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const t = useTranslations("agents");
  return (
    <div style={s.row}>
      {attached && (
        <div style={s.reorderCol}>
          <IconBtn icon="ArrowUp" label={t("skills.moveUp")} size={22} onClick={onMoveUp} />
          <IconBtn icon="ArrowDown" label={t("skills.moveDown")} size={22} onClick={onMoveDown} />
        </div>
      )}
      <div style={s.meta}>
        <div style={s.name}>{skill.name}</div>
        <div style={s.description}>{skill.description}</div>
      </div>
      {!skill.enabled && <Badge color="var(--text-muted)">{t("skills.notInjected")}</Badge>}
      <Toggle on={attached} onChange={onToggle} size={16} />
    </div>
  );
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const { data: allSkills, isLoading: skillsLoading, isError: skillsError, refetch: refetchSkills } = useSkills();
  const { data: links, isLoading: linksLoading, isError: linksError, refetch: refetchLinks } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();

  const loading = skillsLoading || linksLoading;
  const error = skillsError || linksError;

  const attachedIds = React.useMemo(
    () => [...(links ?? [])].sort((a, b) => a.order - b.order).map((l) => l.skill_id),
    [links],
  );
  const skillById = React.useMemo(() => new Map((allSkills ?? []).map((sk) => [sk.id, sk])), [allSkills]);
  const attachedSkills = attachedIds.map((id) => skillById.get(id)).filter((sk): sk is Skill => !!sk);
  const unattachedSkills = (allSkills ?? []).filter((sk) => !attachedIds.includes(sk.id));

  const apply = (nextIds: string[]) => setSkills.mutate({ agentId: agent.id, skillIds: nextIds });

  if (loading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={20} width={160} style={{ marginBottom: 16 }} />
        <Skeleton height={64} style={{ marginBottom: 8 }} />
        <Skeleton height={64} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("skills.loadError")} onRetry={() => { void refetchSkills(); void refetchLinks(); }} />
      </div>
    );
  }
  if ((allSkills ?? []).length === 0) {
    return (
      <div style={s.wrap}>
        <EmptyState
          icon="Sparkles"
          title={t("skills.emptyTitle")}
          body={t("skills.emptyBody")}
          cta={t("skills.emptyCta")}
          onCta={() => router.push("/skills")}
        />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("skills.attachedCount", { count: attachedSkills.length })}
        </span>
      </div>
      <div style={s.hint}>{t("skills.orderHint")}</div>

      <div style={s.browseRow}>
        <Button kind="ghost" size="sm" icon="ExternalLink" onClick={() => router.push("/skills")}>
          {t("skills.browseAll")}
        </Button>
      </div>

      {attachedSkills.length > 0 && (
        <div style={s.attachedSection}>
          {attachedSkills.map((skill, i) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              attached
              disabledUp={i === 0}
              disabledDown={i === attachedSkills.length - 1}
              onToggle={(on) => !on && apply(attachedIds.filter((id) => id !== skill.id))}
              onMoveUp={() => apply(moveId(attachedIds, i, "up"))}
              onMoveDown={() => apply(moveId(attachedIds, i, "down"))}
            />
          ))}
        </div>
      )}

      {unattachedSkills.length > 0 && (
        <div>
          <p style={s.sectionTitle}>{t("skills.filterPlaceholder")}</p>
          {unattachedSkills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              attached={false}
              onToggle={(on) => on && apply([...attachedIds, skill.id])}
            />
          ))}
        </div>
      )}
    </div>
  );
}
