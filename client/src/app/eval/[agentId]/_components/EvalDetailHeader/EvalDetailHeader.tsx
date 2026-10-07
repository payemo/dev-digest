/* EvalDetailHeader — "‹ All agents", agent name + model, the agent switcher,
   the time window, Run eval ("Running…" + live k/n progress while a run is in
   flight; disabled with no cases) and "<n> runs on the <m>-case set". */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Dropdown, Icon } from "@devdigest/ui";
import type { EvalAgentDetail, EvalAgentRun, EvalCaseResult } from "@devdigest/shared";
import { RunProgress } from "@/components/eval-metrics";
import { useAgents } from "@/lib/hooks/agents";
import { WINDOW_OPTIONS } from "./constants";
import { s } from "./styles";

export function EvalDetailHeader({
  detail,
  days,
  onDays,
  liveRun,
  results,
  starting,
  onRun,
}: {
  detail: EvalAgentDetail;
  days: number;
  onDays: (d: number) => void;
  liveRun: Pick<EvalAgentRun, "cases_done" | "cases_total" | "status" | "error"> | null;
  results?: EvalCaseResult[];
  starting: boolean;
  onRun: () => void;
}) {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: agents } = useAgents();
  return (
    <div style={s.wrap}>
      <Link href="/eval" style={s.back}>
        <Icon.ChevronLeft size={14} />
        {t("detail.allAgents")}
      </Link>
      <div style={s.titleRow}>
        <div>
          <div style={s.nameRow}>
            <h1 style={s.h1}>{detail.agent_name}</h1>
            <Badge mono>{detail.model}</Badge>
          </div>
          <p style={s.subtitle}>
            {t("detail.runsOnSet", { runs: detail.runs_in_window, cases: detail.cases_total })}
          </p>
        </div>
        <div style={s.actions}>
          <Dropdown
            align="right"
            trigger={
              <Button kind="secondary" size="sm" icon="Cpu" iconRight="ChevronDown">
                {detail.agent_name}
              </Button>
            }
            items={(agents ?? []).map((a) => ({ label: a.name, icon: "Cpu" as const, onClick: () => router.push(`/eval/${a.id}`) }))}
          />
          <Dropdown
            align="right"
            width={140}
            trigger={
              <Button kind="secondary" size="sm" icon="Calendar">
                {t("detail.window", { days })}
              </Button>
            }
            items={WINDOW_OPTIONS.map((d) => ({ label: t("detail.window", { days: d }), onClick: () => onDays(d) }))}
          />
          <Button
            kind="primary"
            size="sm"
            icon={liveRun ? undefined : "Play"}
            loading={!!liveRun || starting}
            disabled={detail.cases_total === 0}
            onClick={onRun}
          >
            {liveRun ? t("progress.running") : t("detail.runEval")}
          </Button>
        </div>
      </div>
      {liveRun && (
        <div style={s.progress}>
          <RunProgress run={liveRun} results={results} />
        </div>
      )}
    </div>
  );
}
