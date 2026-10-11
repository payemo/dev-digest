/* RunReviewDropdown — the PR page's "Run Review" trigger. Opens an agent
   picker: tick any set of ENABLED agents (all ticked on every open) and start
   them as one multi-agent run, or "Run all enabled agents". Either way the
   user lands on Multi-Agent Review for this PR. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useMultiAgentCandidates } from "@/lib/hooks/multi-agent";
import { useRunReview, type RunReviewInput } from "@/lib/hooks/reviews";
import { AgentPicker } from "./_components/AgentPicker";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  repoId,
  prNumber,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  repoId: string;
  prNumber: number;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const run = useRunReview();
  const [open, setOpen] = React.useState(false);
  // null = "every enabled agent" (the default on each open, even before the
  // candidates have loaded); a Set once the user changes the selection.
  const [ticked, setTicked] = React.useState<Set<string> | null>(null);
  const { data: candidates, isLoading } = useMultiAgentCandidates(prId);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click — same pattern as the vendored Dropdown.
  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const all = candidates ?? [];
  const tickedIds = all
    .filter((c) => (ticked ? ticked.has(c.agent_id) : true))
    .map((c) => c.agent_id);

  const toggleOpen = () => {
    if (!open) setTicked(null);
    setOpen((o) => !o);
  };

  const toggle = (agentId: string) => {
    const next = new Set(tickedIds);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    setTicked(next);
  };

  const kick = async (opts: Omit<RunReviewInput, "prId">) => {
    setOpen(false);
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, ...opts });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
      router.push(`/repos/${repoId}/multi-agent/${prNumber}`);
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={ref} style={s.root}>
      <span title={warnMerged ? t("runReview.mergedTooltip") : undefined} style={s.trigger(warnMerged)}>
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={run.isPending}
          aria-expanded={open}
          onClick={toggleOpen}
        >
          {run.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div style={s.popover} role="dialog" aria-label={t("runReview.pickAgents")}>
          <AgentPicker
            candidates={all}
            loading={isLoading}
            tickedIds={tickedIds}
            warnMerged={warnMerged}
            pending={run.isPending}
            onToggle={toggle}
            onClear={() => setTicked(new Set())}
            onRun={() => kick({ agentIds: tickedIds })}
            onRunAll={() => kick({ all: true })}
            onConfigure={() => router.push(`/repos/${repoId}/multi-agent/new?pr=${prNumber}`)}
            onOpenAgents={() => router.push("/agents")}
          />
        </div>
      )}
    </div>
  );
}
