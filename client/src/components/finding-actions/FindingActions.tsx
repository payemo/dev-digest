/* FindingActions — Accept / Dismiss / Turn into eval case (+ a disabled Learn
   on Multi-Agent Review). Shared by FindingCard (expanded body) and the
   Multi-Agent columns, so the decision rules live in one place. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import { EvalCaseModal } from "@/components/eval-case-modal";
import { s } from "./styles";

export function FindingActions({
  f,
  onAction,
  pending,
  showLearn = false,
  marginTop,
}: {
  f: Pick<FindingRecord, "id" | "title" | "accepted_at" | "dismissed_at">;
  onAction?: (action: FindingActionKind) => void;
  pending?: boolean;
  /** Show a disabled "Learn" action (Multi-Agent Review); off on the PR page. */
  showLearn?: boolean;
  marginTop?: number;
}) {
  const t = useTranslations("prReview");
  const tEval = useTranslations("eval");
  const [evalOpen, setEvalOpen] = React.useState(false);
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <>
      <div style={s.actions(marginTop)}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          disabled={pending}
          active={accepted}
          onClick={() => onAction?.("accept")}
        >
          {t("finding.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={pending}
          active={dismissed}
          onClick={() => onAction?.("dismiss")}
        >
          {t("finding.dismiss")}
        </Button>
        {/* Enabled only once the finding carries a persisted decision —
            accepted seeds a must_find case, dismissed a must_not_flag one. */}
        <span title={muted ? undefined : tEval("finding.needsDecision")}>
          <Button
            kind="ghost"
            size="sm"
            icon="FlaskConical"
            disabled={!muted}
            onClick={() => setEvalOpen(true)}
          >
            {tEval("finding.turnIntoCase")}
          </Button>
        </span>
        {/* Learn is not built yet: visible, disabled, no handler, no call.
            Button takes no `title`, so the tooltip sits on a wrapper. */}
        {showLearn && (
          <span title={t("finding.learnComingSoon")}>
            <Button kind="ghost" size="sm" icon="Brain" disabled>
              {t("finding.learn")}
            </Button>
          </span>
        )}
      </div>
      {evalOpen && (
        <EvalCaseModal
          mode={{ kind: "fromFinding", findingId: f.id, findingTitle: f.title }}
          onClose={() => setEvalOpen(false)}
        />
      )}
    </>
  );
}
