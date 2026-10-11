/* CiFailOnControl — the agent's `ci_fail_on` gate as a segmented control
   (Critical / Warning + / Never). `any` can only be set in Config; when it is
   active it shows as a read-only selected pill. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { CiFailOn } from "@devdigest/shared";
import { FAIL_ON_OPTIONS } from "./constants";
import { s } from "./styles";

export function CiFailOnControl({
  value,
  onChange,
  disabled,
}: {
  value: CiFailOn;
  onChange: (next: Exclude<CiFailOn, "any">) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("ci");
  return (
    <div style={s.card}>
      <div style={s.text}>
        <div style={s.title}>{t("ciTab.failOnTitle")}</div>
        <div style={s.body}>{t("ciTab.failOnBody")}</div>
      </div>
      <div role="radiogroup" aria-label={t("ciTab.failOnTitle")} style={s.group}>
        {FAIL_ON_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => value !== o.value && onChange(o.value)}
            style={s.pill(value === o.value)}
          >
            {t(o.labelKey)}
          </button>
        ))}
        {value === "any" && (
          <span role="radio" aria-checked="true" aria-disabled="true" style={s.readOnlyPill}>
            {t("ciTab.failOn.any")}
          </span>
        )}
      </div>
    </div>
  );
}
