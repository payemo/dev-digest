/* PrecisionDipBanner — "Precision dipped Npts on vX", plus how recall and
   citation moved. The server decides whether it shows (≥ 1 whole point drop,
   both precisions applicable); this only renders it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalPrecisionDip } from "@devdigest/shared";
import { movement } from "./helpers";
import { s } from "./styles";

export function PrecisionDipBanner({ alert }: { alert: EvalPrecisionDip }) {
  const t = useTranslations("eval");
  const recall = movement(alert.recall_delta);
  const citation = movement(alert.citation_delta);
  return (
    <div style={s.banner} role="alert">
      <Icon.AlertTriangle size={16} style={s.icon} />
      <span>
        <strong>{t("detail.dip", { points: alert.points })}</strong> {t("detail.dipOn", { version: alert.version })} —{" "}
        {t("detail.dipDetail", {
          recall: t(recall.key, { points: recall.points }),
          citation: t(citation.key, { points: citation.points }),
        })}
      </span>
    </div>
  );
}
