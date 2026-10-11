/* CiTab — the agent's CI deployment: where it is installed, each install's
   last run, the Fail CI on gate, "Update CI config" and the Add to CI wizard.
   While mounted it keeps CI runs synced from GitHub Actions. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn, CiRunStatus } from "@devdigest/shared";
import { useAgentCi, useCiAutoSync, useUpdateCiConfig } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { ciKeys } from "@/lib/hooks/keys";
import { useToast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { CiFailOnControl } from "./_components/CiFailOnControl";
import { CiInstallationRow } from "./_components/CiInstallationRow";
import { ExportWizard } from "./_components/ExportWizard";
import { runStatusOf, statusTone } from "@/lib/ci-status";
import { timeAgo } from "./helpers";
import { s } from "./styles";

function RunStatusBadge({ status }: { status: CiRunStatus | null }) {
  const t = useTranslations("ci");
  if (!status) return null;
  return (
    <Badge dot {...statusTone(status)}>
      {t(`ciTab.lastRun.${status}`)}
    </Badge>
  );
}

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const toast = useToast();
  const qc = useQueryClient();
  const overview = useAgentCi(agent.id);
  const update = useUpdateCiConfig(agent.id);
  const updateAgent = useUpdateAgent();
  const [wizardOpen, setWizardOpen] = React.useState(false);
  useCiAutoSync(true);

  const data = overview.data;
  const installations = data?.installations ?? [];
  const prInstalls = installations.filter((i) => i.branch != null).length;
  const failOn: CiFailOn = data?.ci_fail_on ?? agent.ci_fail_on;

  const onFailOn = (next: Exclude<CiFailOn, "any">) =>
    updateAgent.mutate(
      { id: agent.id, patch: { ci_fail_on: next } },
      // The repo's manifest now differs from the agent — refresh "outdated".
      { onSuccess: () => qc.invalidateQueries({ queryKey: ciKeys.agent(agent.id) }) },
    );

  const onUpdate = () =>
    update.mutate(undefined, {
      onSuccess: (res) => toast.success(t("ciTab.updatedToast", { count: res.installations.length })),
      onError: (err) => toast.error(t("ciTab.updateFailed", { message: (err as Error).message })),
    });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.h2}>{t("ciTab.title")}</span>
        {(data?.active_repos ?? 0) > 0 && (
          <Badge dot color="var(--ok)" bg="var(--ok-bg)">
            {t("ciTab.activeIn", { count: data!.active_repos })}
          </Badge>
        )}
        <div style={s.actions}>
          <Button icon="RefreshCw" loading={update.isPending} disabled={prInstalls === 0 || update.isPending} onClick={onUpdate}>
            {t("ciTab.updateConfig")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={() => setWizardOpen(true)}>
            {t("ciTab.addToCi")}
          </Button>
        </div>
      </div>

      <CiFailOnControl value={failOn} onChange={onFailOn} disabled={updateAgent.isPending} />

      {overview.isLoading ? (
        <Skeleton height={120} />
      ) : overview.isError ? (
        <ErrorState body={t("ciTab.loadError")} onRetry={() => overview.refetch()} />
      ) : (
        <div style={s.list}>
          {installations.map((inst) => (
            <CiInstallationRow key={inst.id} installation={inst} />
          ))}
          <button type="button" style={s.addRow} onClick={() => setWizardOpen(true)}>
            <Icon.Plus size={14} />
            {t("ciTab.addRepository")}
          </button>
        </div>
      )}

      {(data?.recent_runs.length ?? 0) > 0 && (
        <div style={s.history}>
          <SectionLabel
            icon="History"
            right={
              <Link href={`/ci-runs?agent_id=${agent.id}`} style={s.link}>
                {t("ciTab.viewAllRuns")}
              </Link>
            }
          >
            {t("ciTab.historyTitle")}
          </SectionLabel>
          {data!.recent_runs.map((run) => (
            <div key={run.id} style={s.historyRow}>
              <span className="mono" style={s.historyRepo}>
                {run.repo}
                {run.pr_number != null ? ` #${run.pr_number}` : ""}
              </span>
              {run.verification === "unverified" && (
                <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                  {t("runs.unverified")}
                </Badge>
              )}
              <RunStatusBadge status={runStatusOf(run.status)} />
              <span style={s.muted}>{timeAgo(run.ran_at)}</span>
            </div>
          ))}
        </div>
      )}

      {wizardOpen && <ExportWizard agent={agent} onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
