/* SkillsWorkbench — master-detail shell for /skills and /skills/:id, mirroring
   the Agents editor's layout (280px list + tabbed editor, ?tab= URL state). */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Skeleton, Icon, Badge, EmptyState } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkill } from "../../../../lib/hooks/skills";
import { ApiError } from "../../../../lib/api";
import { SkillList } from "./_components/SkillList";
import { SkillEditor } from "./_components/SkillEditor";
import { resolveTab } from "./helpers";
import { s } from "./styles";

export function SkillsWorkbench({ skillId }: { skillId?: string }) {
  const t = useTranslations("skills");
  const search = useSearchParams();
  const router = useRouter();

  const { data: skill, isLoading, isError, error, refetch } = useSkill(skillId);
  const tab = resolveTab(search.get("tab"));
  const setTab = (nextTab: string) => {
    if (!skillId) return;
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", nextTab);
    router.replace(`/skills/${skillId}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    ...(skillId ? [{ label: skill?.name ?? t("detail.crumbSkill") }] : []),
  ];

  if (skillId && (isError || (!isLoading && !skill))) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.notFound.title")}
          body={error instanceof ApiError ? error.message : t("detail.notFound.body")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.row}>
        <div style={s.listCol}>
          <SkillList activeId={skillId} onSelect={(sk) => router.push(`/skills/${sk.id}?tab=${tab}`)} />
        </div>

        {!skillId ? (
          <div style={s.editorCol}>
            <EmptyState icon="Sparkles" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
          </div>
        ) : isLoading || !skill ? (
          <div style={s.skeletonWrap}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={s.editorCol}>
            <div style={s.editorHeader}>
              <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
              <h1 style={s.editorTitle}>{skill.name}</h1>
              <Badge color="var(--text-secondary)">v{skill.version}</Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
              <div style={{ marginLeft: "auto" }}>
                <Button kind="secondary" size="sm" icon="GitPullRequest" onClick={() => router.push("/")}>
                  {t("editor.header.runOnPr")}
                </Button>
              </div>
            </div>
            <div style={s.editorBody}>
              <SkillEditor skill={skill} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
