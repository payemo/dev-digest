/* ConfigureRun — the Configure run screen: step 1 picks a pull request,
   step 2 ticks agents (all ticked when a PR is chosen), each with its
   estimate; the footer shows the selection's total and starts the run. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import { usePulls } from "@/lib/hooks";
import { useMultiAgentCandidates } from "@/lib/hooks/multi-agent";
import { useRunReview } from "@/lib/hooks/reviews";
import { formatDurationEstimate } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { formatCostEstimate, selectionTotals } from "../../helpers";
import { AgentCard } from "./_components/AgentCard";
import { s } from "./styles";

export function ConfigureRun({
  repoId,
  initialPrNumber,
}: {
  repoId: string;
  initialPrNumber: number | null;
}) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { data: pulls } = usePulls(repoId);
  const [prNumber, setPrNumber] = React.useState<number | null>(initialPrNumber);
  // null = every enabled agent ticked (the default whenever a PR is chosen).
  const [ticked, setTicked] = React.useState<Set<string> | null>(null);
  const run = useRunReview();

  const prId = pulls?.find((p) => p.number === prNumber)?.id ?? null;
  const candidates = useMultiAgentCandidates(prId);
  const all = candidates.data ?? [];
  const tickedIds = all
    .filter((c) => (ticked ? ticked.has(c.agent_id) : true))
    .map((c) => c.agent_id);
  const totals = selectionTotals(all, tickedIds);

  const choosePr = (v: string) => {
    setPrNumber(v ? Number(v) : null);
    setTicked(null);
  };
  const toggle = (agentId: string) => {
    const next = new Set(tickedIds);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    setTicked(next);
  };
  // Errors (429 rate limit, 422 disabled agent) toast via the global mutation
  // error handler; the user stays here to adjust.
  const start = () => {
    if (!prId || prNumber == null || tickedIds.length === 0) return;
    run.mutate(
      { prId, agentIds: tickedIds },
      { onSuccess: () => router.push(`/repos/${repoId}/multi-agent/${prNumber}`) },
    );
  };

  const prOptions = [
    { value: "", label: t("configure.prPlaceholder") },
    ...(pulls ?? []).map((p) => ({
      value: String(p.number),
      label: t("configure.prOption", { number: p.number, title: p.title }),
    })),
  ];

  const duration = formatDurationEstimate(totals.durationMs) ?? "—";
  const cost = formatCostEstimate(totals.costUsd) ?? "—";

  return (
    <div style={s.root}>
      <div>
        <h1 style={s.h1}>{t("configure.title")}</h1>
        <p style={s.subtitle}>{t("configure.subtitle")}</p>
      </div>

      <section style={s.step} aria-label={t("configure.stepPr")}>
        <div style={s.stepTitle}>
          <span style={s.stepNum}>1</span>
          {t("configure.stepPr")}
        </div>
        <div style={s.selectWrap}>
          <SelectInput
            mono={false}
            value={prNumber != null ? String(prNumber) : ""}
            onChange={choosePr}
            options={prOptions}
          />
        </div>
      </section>

      <section style={s.step} aria-label={t("configure.stepAgents")}>
        <div style={s.stepHead}>
          <div style={s.stepTitle}>
            <span style={s.stepNum}>2</span>
            {t("configure.stepAgents")}
          </div>
          {prId && all.length > 0 && (
            <button type="button" style={s.selectAll} onClick={() => setTicked(null)}>
              {t("configure.selectAll")}
            </button>
          )}
        </div>
        {!prId ? (
          <div style={s.muted}>{t("configure.pickPrFirst")}</div>
        ) : candidates.isLoading ? (
          <Skeleton height={64} />
        ) : candidates.isError ? (
          <ErrorState
            title={t("configure.loadError")}
            body={candidates.error instanceof ApiError ? candidates.error.message : undefined}
            onRetry={() => candidates.refetch()}
          />
        ) : all.length === 0 ? (
          <EmptyState
            icon="Cpu"
            title={t("configure.noAgentsTitle")}
            body={t("configure.noAgentsBody")}
            cta={t("configure.noAgentsAction")}
            onCta={() => router.push("/agents")}
          />
        ) : (
          <div style={s.cards}>
            {all.map((c) => (
              <AgentCard
                key={c.agent_id}
                candidate={c}
                checked={tickedIds.includes(c.agent_id)}
                onToggle={() => toggle(c.agent_id)}
              />
            ))}
          </div>
        )}
      </section>

      <div style={s.footer}>
        <Button
          kind="primary"
          icon="Users"
          loading={run.isPending}
          disabled={!prId || tickedIds.length === 0 || run.isPending}
          onClick={start}
        >
          {t("configure.run", { count: prId ? tickedIds.length : 0 })}
        </Button>
        {prId && tickedIds.length > 0 && (
          <span style={s.total} data-testid="selection-total">
            {t("configure.total", { duration, cost })}
            {totals.partial && <span style={s.partial}>{t("configure.partial")}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
