/* StatsPeriodSelector — "1 day / 30 days / Custom". Custom adds two date
   inputs; an invalid range shows an inline message and the caller's window
   stays null, so no request fires for it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput, TextInput } from "@devdigest/ui";
import { PERIODS, type StatsPeriod } from "./constants";
import type { StatsPeriodApi } from "./useStatsPeriod";
import { s } from "./styles";

export function StatsPeriodSelector({ value }: { value: StatsPeriodApi }) {
  const t = useTranslations("agentPerformance");
  const { period, setPeriod, customRange, setCustomRange, window } = value;
  const from = customRange.from ?? "";
  const to = customRange.to ?? "";
  const invalid = period === "custom" && window === null;

  return (
    <div style={s.selector}>
      <div style={s.row}>
        {period === "custom" && (
          <>
            <label style={s.dateLabel}>
              {t("period.from")}
              <TextInput
                type="date"
                value={from}
                aria-label={t("period.from")}
                aria-invalid={invalid}
                onChange={(v) => setCustomRange(v, to)}
              />
            </label>
            <label style={s.dateLabel}>
              {t("period.to")}
              <TextInput
                type="date"
                value={to}
                aria-label={t("period.to")}
                aria-invalid={invalid}
                onChange={(v) => setCustomRange(from, v)}
              />
            </label>
          </>
        )}
        <div style={s.periodSelect} role="group" aria-label={t("period.label")}>
          <SelectInput
            mono={false}
            value={period}
            onChange={(v) => setPeriod(v as StatsPeriod)}
            options={PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))}
          />
        </div>
      </div>
      {invalid && (
        <span role="alert" style={s.invalid}>
          {t("period.invalidRange")}
        </span>
      )}
    </div>
  );
}
