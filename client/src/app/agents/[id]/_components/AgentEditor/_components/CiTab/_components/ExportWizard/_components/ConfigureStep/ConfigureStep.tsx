/* ConfigureStep — which pull_request events trigger the review, and how the
   result is posted (GitHub review / PR comment / exit code only). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Chip, Icon } from "@devdigest/ui";
import type { CiPostAs, CiTrigger } from "@devdigest/shared";
import { POST_AS_OPTIONS, TRIGGERS } from "../../constants";
import { s } from "./styles";

export function ConfigureStep({
  triggers,
  postAs,
  onToggleTrigger,
  onPostAs,
}: {
  triggers: CiTrigger[];
  postAs: CiPostAs;
  onToggleTrigger: (t: CiTrigger) => void;
  onPostAs: (p: CiPostAs) => void;
}) {
  const t = useTranslations("ci");
  return (
    <div style={s.wrap}>
      <div>
        <div style={s.label}>{t("exportWizard.triggerLabel")}</div>
        <div style={s.chips}>
          {TRIGGERS.map((tr) => (
            <Chip
              key={tr}
              active={triggers.includes(tr)}
              icon={triggers.includes(tr) ? "Check" : undefined}
              onClick={() => onToggleTrigger(tr)}
            >
              <span className="mono">pull_request:{tr}</span>
            </Chip>
          ))}
        </div>
        {triggers.length === 0 && <div style={s.error}>{t("exportWizard.triggerRequired")}</div>}
      </div>
      <div>
        <div style={s.label}>{t("exportWizard.postResultsLabel")}</div>
        <div role="radiogroup" aria-label={t("exportWizard.postResultsLabel")} style={s.radios}>
          {POST_AS_OPTIONS.map((o) => (
            <label key={o.value} style={s.radio}>
              <input
                type="radio"
                name="ci-post-as"
                value={o.value}
                checked={postAs === o.value}
                onChange={() => onPostAs(o.value)}
              />
              {t(o.labelKey)}
              {o.recommended && (
                <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                  {t("exportWizard.recommended")}
                </Badge>
              )}
            </label>
          ))}
        </div>
      </div>
      <div style={s.note}>
        <Icon.Info size={14} style={s.noteIcon} />
        <span>{t.rich("exportWizard.blockMergeNote", { b: (chunks) => <strong>{chunks}</strong> })}</span>
      </div>
    </div>
  );
}
