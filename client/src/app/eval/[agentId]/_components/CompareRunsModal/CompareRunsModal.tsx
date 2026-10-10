/* CompareRunsModal — two runs of one agent, always older → newer: metric
   deltas (points; cost in currency), the system-prompt line diff between the
   two runs' agent versions, model / skill / case-set differences, and
   Promote v<newer> (with a confirm step that warns, before confirming, when
   the run's skills differ from the ones linked now). No model call: the diff
   is computed here from two strings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Icon, Modal, SectionLabel, Skeleton } from "@devdigest/ui";
import { costDelta, costLabel, pct, pointsDelta } from "@/lib/eval-format";
import { useEvalCompare, usePromoteVersion } from "@/lib/hooks/eval";
import { computeLineDiff } from "@/lib/line-diff";
import { configLines, promoteTarget } from "./helpers";
import { s } from "./styles";

function DeltaCard({ label, from, to, delta }: { label: string; from: string; to: string; delta: string | null }) {
  const up = delta?.startsWith("+");
  const down = delta?.startsWith("-");
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={s.cardValues}>
        <span style={s.from}>{from}</span>
        <Icon.ArrowRight size={12} style={{ color: "var(--text-muted)" }} />
        <span style={s.to}>{to}</span>
        {delta && <span style={s.delta(up ? "up" : down ? "down" : "flat")}>{delta}</span>}
      </div>
    </div>
  );
}

export function CompareRunsModal({
  agentId,
  a,
  b,
  onClose,
}: {
  agentId: string;
  a: string;
  b: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const compare = useEvalCompare(a, b);
  const promote = usePromoteVersion();
  const [confirming, setConfirming] = React.useState(false);
  const c = compare.data;

  if (!c) {
    return (
      <Modal width={860} title={t("compare.subtitle")} onClose={onClose}>
        <div style={s.body}>
          {compare.isError ? (
            <ErrorState body={compare.error?.message ?? t("compare.loadError")} onRetry={() => compare.refetch()} />
          ) : (
            <Skeleton height={220} />
          )}
        </div>
      </Modal>
    );
  }

  const target = promoteTarget(c);
  const diff = computeLineDiff(c.old_prompt, c.new_prompt);
  const footer = confirming ? (
    <div style={s.footer}>
      {target.skillMismatch && (
        <div style={s.warning} role="alert">
          <Icon.AlertTriangle size={14} style={{ flexShrink: 0 }} />
          {t("compare.skillMismatch")}
        </div>
      )}
      <div style={s.footerRow}>
        <span style={s.confirmText}>{t("compare.confirmBody", { version: target.version })}</span>
        <Button kind="secondary" onClick={() => setConfirming(false)}>
          {t("compare.back")}
        </Button>
        <Button
          kind="primary"
          icon="GitMerge"
          loading={promote.isPending}
          onClick={() => promote.mutate({ agentId, runId: c.new.id }, { onSuccess: onClose })}
        >
          {t("compare.confirm")}
        </Button>
      </div>
      {promote.error && <div style={s.error}>{promote.error.message}</div>}
    </div>
  ) : (
    <div style={s.footerRow}>
      <Button kind="secondary" onClick={onClose}>
        {t("compare.close")}
      </Button>
      <span title={target.available ? undefined : t("compare.promoteActive", { version: target.version })}>
        <Button kind="primary" icon="GitMerge" disabled={!target.available} onClick={() => setConfirming(true)}>
          {t("compare.promote", { version: target.version })}
        </Button>
      </span>
      {!target.available && <span style={s.muted}>{t("compare.promoteActive", { version: target.version })}</span>}
    </div>
  );

  return (
    <Modal
      width={860}
      title={t("compare.title", { old: c.old.agent_version, new: c.new.agent_version })}
      subtitle={t("compare.subtitle")}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.body}>
        <div style={s.cards}>
          <DeltaCard label={t("compare.recall")} from={pct(c.old.recall)} to={pct(c.new.recall)} delta={pointsDelta(c.delta.recall)} />
          <DeltaCard
            label={t("compare.precision")}
            from={pct(c.old.precision)}
            to={pct(c.new.precision)}
            delta={pointsDelta(c.delta.precision)}
          />
          <DeltaCard
            label={t("compare.citation")}
            from={pct(c.old.citation_accuracy)}
            to={pct(c.new.citation_accuracy)}
            delta={pointsDelta(c.delta.citation_accuracy)}
          />
          <DeltaCard
            label={t("compare.cost")}
            from={costLabel(c.old.cost_usd)}
            to={costLabel(c.new.cost_usd)}
            delta={costDelta(c.delta.cost_usd)}
          />
        </div>

        <div>
          <SectionLabel icon="FileText">{t("compare.promptDiff")}</SectionLabel>
          {c.same_prompt ? (
            <div style={s.muted}>{t("compare.samePrompt")}</div>
          ) : (
            <>
              <div style={s.legend}>
                <span style={s.legendItem}>
                  <span style={s.swatch("del")} />
                  {t("compare.oldLegend", { version: c.old.agent_version })}
                </span>
                <span style={s.legendItem}>
                  <span style={s.swatch("add")} />
                  {t("compare.newLegend", { version: c.new.agent_version })}
                </span>
              </div>
              <pre className="mono" style={s.diff} data-testid="eval-prompt-diff">
                {diff.map((line, i) => (
                  // Positional rows of a static diff — the index is the identity.
                  <span key={i} data-kind={line.kind} style={s.diffLine(line.kind)}>
                    {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                    {line.text || " "}
                  </span>
                ))}
              </pre>
            </>
          )}
        </div>

        <div>
          <SectionLabel icon="Settings">{t("compare.configHeading")}</SectionLabel>
          <ul style={s.list}>
            {configLines(c).map((l, i) => (
              <li key={`${l.key}-${i}`}>{t(l.key, l.values)}</li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
