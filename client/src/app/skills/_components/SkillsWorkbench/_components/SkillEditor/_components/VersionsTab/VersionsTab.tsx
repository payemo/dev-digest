/* VersionsTab — immutable body history (skill_versions), newest first. Each
   earlier version gets Diff (against the current active body) and Restore
   (snapshot its body back in as a new version); the current version just
   gets the Current badge. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton, ErrorState } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "../../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../../lib/toast";
import { DiffModal } from "./_components/DiffModal";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const update = useUpdateSkill();
  const [diffTarget, setDiffTarget] = React.useState<SkillVersion | null>(null);
  const [restoringVersion, setRestoringVersion] = React.useState<number | null>(null);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={200} width={400} />
      </div>
    );
  }
  if (isError || !versions) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
      </div>
    );
  }

  const current = versions.find((v) => v.version === skill.version);

  const restore = (v: SkillVersion) => {
    if (!window.confirm(t("editor.versions.restoreConfirm", { version: v.version }))) return;
    setRestoringVersion(v.version);
    update.mutate(
      { id: skill.id, patch: { body: v.body } },
      {
        onSuccess: (data) => {
          toast.success(t("editor.versions.restoredToast", { version: v.version, newVersion: data.version }));
        },
        onSettled: () => setRestoringVersion(null),
      },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("editor.versions.title")}</h2>
        <Badge color="var(--text-muted)">{t("editor.versions.count", { count: versions.length })}</Badge>
      </div>
      <div style={s.list}>
        {versions.length === 0 ? (
          <div style={s.empty}>{t("editor.versions.empty")}</div>
        ) : (
          versions.map((v) => {
            const isCurrent = v.version === skill.version;
            return (
              <div key={v.version} style={s.row(isCurrent)}>
                <div>
                  <div style={s.version}>v{v.version}</div>
                  <div style={s.date}>
                    {t("editor.versions.createdAt", { date: new Date(v.created_at).toLocaleDateString() })}
                  </div>
                </div>
                {isCurrent ? (
                  <Badge color="var(--ok)">{t("editor.versions.current")}</Badge>
                ) : (
                  <div style={s.actions}>
                    <Button kind="secondary" size="sm" icon="Eye" onClick={() => setDiffTarget(v)} disabled={!current}>
                      {t("editor.versions.diff")}
                    </Button>
                    <Button
                      kind="secondary"
                      size="sm"
                      icon="History"
                      onClick={() => restore(v)}
                      disabled={restoringVersion !== null}
                    >
                      {restoringVersion === v.version ? t("editor.versions.restoring") : t("editor.versions.restore")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {diffTarget && current && <DiffModal base={diffTarget} current={current} onClose={() => setDiffTarget(null)} />}
    </div>
  );
}
