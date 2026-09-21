/* SkillList — search + AddSkillMenu + the scrolling list of SkillListItem. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { TextInput, EmptyState, Skeleton, ErrorState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkills } from "../../../../../../lib/hooks/skills";
import { AddSkillMenu } from "../AddSkillMenu";
import { SkillListItem } from "./_components/SkillListItem";
import { s } from "./styles";

export function SkillList({
  activeId,
  onSelect,
}: {
  activeId?: string;
  onSelect: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const [q, setQ] = React.useState("");
  const { data: skills, isLoading, isError, refetch } = useSkills();

  const filtered = React.useMemo(() => {
    if (!skills) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter(
      (sk) => sk.name.toLowerCase().includes(needle) || sk.description.toLowerCase().includes(needle),
    );
  }, [skills, q]);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.headerRow}>
          <h1 style={s.title}>{t("page.heading")}</h1>
          <AddSkillMenu />
        </div>
        <TextInput value={q} onChange={setQ} placeholder={t("page.searchPlaceholder")} />
      </div>
      <div style={s.scroll}>
        {isLoading ? (
          <>
            <Skeleton height={90} style={{ marginBottom: 10 }} />
            <Skeleton height={90} style={{ marginBottom: 10 }} />
            <Skeleton height={90} />
          </>
        ) : isError ? (
          <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState icon="Sparkles" title={t("page.empty.title")} body={t("page.empty.body")} />
        ) : (
          filtered.map((sk) => (
            <SkillListItem key={sk.id} skill={sk} active={sk.id === activeId} onClick={() => onSelect(sk)} />
          ))
        )}
      </div>
    </div>
  );
}
