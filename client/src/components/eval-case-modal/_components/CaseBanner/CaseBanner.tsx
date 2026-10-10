/* CaseBanner — "POSITIVE CASE — MUST find …" / "NEGATIVE CASE — MUST NOT comment on …". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalExpectationKind } from "@devdigest/shared";
import { s } from "./styles";

export function CaseBanner({
  kind,
  title,
  location,
}: {
  kind: EvalExpectationKind;
  title: string | null;
  location: string | null;
}) {
  const t = useTranslations("eval");
  const positive = kind === "must_find";
  const I = positive ? Icon.Target : Icon.XCircle;
  let text: string;
  if (positive) text = t("modal.positiveBanner", { title: title ?? "", location: location ?? "" });
  else if (location && title) text = t("modal.negativeBanner", { location, title });
  else if (location) text = t("modal.negativeBannerNoTitle", { location });
  else text = t("modal.negativeBannerAny");
  return (
    <div style={s.banner(positive)} data-testid="eval-case-banner">
      <I size={15} style={s.icon(positive)} />
      <div>
        <span style={s.kind(positive)}>{positive ? t("modal.positive") : t("modal.negative")}</span>{" "}
        <span>{text}</span>
      </div>
    </div>
  );
}
