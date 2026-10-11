/* TargetStep — pick the CI target (only GitHub Actions has a generator; the
   others render disabled with "coming soon") and the imported repo. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SelectInput } from "@devdigest/ui";
import type { CiTarget, Repo } from "@devdigest/shared";
import { TARGETS } from "../../constants";
import { s } from "./styles";

export function TargetStep({
  target,
  repo,
  repos,
  onRepo,
}: {
  target: CiTarget;
  repo: string;
  repos: Pick<Repo, "id" | "full_name">[];
  onRepo: (fullName: string) => void;
}) {
  const t = useTranslations("ci");
  return (
    <div>
      <div role="radiogroup" aria-label={t("exportWizard.steps.target")} style={s.grid}>
        {TARGETS.map((tg) => {
          const I = Icon[tg.icon];
          const selected = tg.enabled && tg.key === target;
          const content = (
            <>
              <div style={s.head}>
                <span style={s.iconBox}>
                  <I size={16} />
                </span>
                <span style={s.name}>{t(`exportWizard.targets.${tg.key}`)}</span>
                {tg.enabled ? (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                ) : (
                  <Badge>{t("exportWizard.comingSoon")}</Badge>
                )}
              </div>
              <div style={s.desc}>{t(`exportWizard.targets.${tg.key}Desc`)}</div>
            </>
          );
          // Disabled targets are not options at all: no focus, no click.
          return tg.enabled ? (
            <button key={tg.key} type="button" role="radio" aria-checked={selected} style={s.card(selected, true)}>
              {content}
            </button>
          ) : (
            <div key={tg.key} aria-disabled="true" data-testid={`target-${tg.key}`} style={s.card(false, false)}>
              {content}
            </div>
          );
        })}
      </div>
      <div style={s.repo}>
        <label style={s.label}>{t("exportWizard.repoLabel")}</label>
        {repos.length === 0 ? (
          <div style={s.hint}>{t("exportWizard.noRepos")}</div>
        ) : (
          <SelectInput
            value={repo}
            onChange={onRepo}
            options={repos.map((r) => ({ value: r.full_name, label: r.full_name }))}
          />
        )}
      </div>
    </div>
  );
}
