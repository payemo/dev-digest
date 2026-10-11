/* CiRunsFilters — time window, agent, repo and status. Values live in the
   URL; this only renders the selects and reports changes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import type { CiRunsQueryInput } from "@devdigest/shared";
import { DAY_OPTIONS, DEFAULT_DAYS, STATUS_LABEL_KEY, STATUS_OPTIONS } from "../../constants";
import { s } from "./styles";

export function CiRunsFilters({
  query,
  agents,
  repos,
  onChange,
}: {
  query: CiRunsQueryInput;
  agents: { id: string; name: string }[];
  repos: string[];
  onChange: (key: "days" | "agent_id" | "repo" | "status", value: string | null) => void;
}) {
  const t = useTranslations("ci");
  return (
    <div style={s.bar}>
      <SelectInput
        mono={false}
        value={String(query.days ?? DEFAULT_DAYS)}
        onChange={(v) => onChange("days", v)}
        options={DAY_OPTIONS.map((o) => ({ value: String(o.days), label: t(o.labelKey) }))}
      />
      <SelectInput
        mono={false}
        value={query.agent_id ?? ""}
        onChange={(v) => onChange("agent_id", v || null)}
        options={[
          { value: "", label: t("runs.filters.allAgents") },
          ...agents.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
      <SelectInput
        value={query.repo ?? ""}
        onChange={(v) => onChange("repo", v || null)}
        options={[{ value: "", label: t("runs.filters.allRepos") }, ...repos.map((r) => ({ value: r, label: r }))]}
      />
      <SelectInput
        mono={false}
        value={query.status ?? ""}
        onChange={(v) => onChange("status", v || null)}
        options={[
          { value: "", label: t("runs.filters.allStatuses") },
          ...STATUS_OPTIONS.map((st) => ({ value: st, label: t(`runs.status.${STATUS_LABEL_KEY[st]}`) })),
        ]}
      />
    </div>
  );
}
