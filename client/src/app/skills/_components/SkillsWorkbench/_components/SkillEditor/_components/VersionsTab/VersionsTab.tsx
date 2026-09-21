/* VersionsTab — immutable body history (skill_versions), newest first. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Markdown, Skeleton, ErrorState } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "../../../../../../../../lib/hooks/skills";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const [selected, setSelected] = React.useState<number | null>(null);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={200} width={240} />
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

  const active = selected ?? versions[0]?.version ?? null;
  const activeVersion = versions.find((v) => v.version === active);

  return (
    <div style={s.wrap}>
      <div style={s.list}>
        {versions.length === 0 ? (
          <div style={s.empty}>{t("editor.versions.empty")}</div>
        ) : (
          versions.map((v) => (
            <div key={v.version} style={s.row(v.version === active)} onClick={() => setSelected(v.version)}>
              <div>
                <div style={s.version}>v{v.version}</div>
                <div style={s.date}>{t("editor.versions.createdAt", { date: new Date(v.created_at).toLocaleDateString() })}</div>
              </div>
              {v.version === skill.version && <Badge color="var(--ok)">{t("editor.versions.current")}</Badge>}
            </div>
          ))
        )}
      </div>
      <div style={s.body}>{activeVersion && <Markdown>{activeVersion.body}</Markdown>}</div>
    </div>
  );
}
