/* EvalCaseModal — the eval-case modal shared by the finding card ("Turn into
   eval case": seeded from the finding, two clicks to a saved case) and the
   agent Evals tab (new hand-made case / edit an existing one). Resolves the
   mode, then hands the form to CaseEditor. A finding that cannot be frozen
   shows the server's refusal and saves nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal } from "@devdigest/ui";
import type { EvalCaseInputBody, EvalCaseRecord } from "@devdigest/shared";
import { useEvalCaseSeed } from "@/lib/hooks/eval";
import { MODAL_WIDTH } from "./constants";
import { caseInputFrom, EMPTY_CASE } from "./helpers";
import { s } from "./styles";
import { CaseEditor } from "./_components/CaseEditor";

export type EvalCaseModalMode =
  | { kind: "fromFinding"; findingId: string; findingTitle?: string }
  | { kind: "new"; agentId: string }
  | { kind: "edit"; caseRecord: EvalCaseRecord };

function SeededCase({
  findingId,
  findingTitle,
  onClose,
}: {
  findingId: string;
  findingTitle?: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const seed = useEvalCaseSeed(findingId);
  if (seed.isLoading) {
    return (
      <Modal width={MODAL_WIDTH} title={t("modal.newTitle")} onClose={onClose}>
        <div style={s.state}>{t("modal.loading")}</div>
      </Modal>
    );
  }
  if (seed.isError || !seed.data) {
    return (
      <Modal
        width={560}
        title={t("modal.refused")}
        onClose={onClose}
        footer={<Button onClick={onClose}>{t("modal.close")}</Button>}
      >
        <div style={s.refusal} role="alert">
          <Icon.AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{seed.error?.message}</span>
        </div>
      </Modal>
    );
  }
  const { existing, draft, decision } = seed.data;
  return existing ? (
    <CaseEditor
      initial={caseInputFrom(existing)}
      source={null}
      caseRecord={existing}
      agentId={existing.owner_id}
      findingTitle={findingTitle}
      onClose={onClose}
    />
  ) : (
    <CaseEditor
      initial={draft}
      source={{ findingId, decision }}
      caseRecord={null}
      agentId={null}
      findingTitle={findingTitle}
      onClose={onClose}
    />
  );
}

export function EvalCaseModal({ mode, onClose }: { mode: EvalCaseModalMode; onClose: () => void }) {
  if (mode.kind === "fromFinding") {
    return <SeededCase findingId={mode.findingId} findingTitle={mode.findingTitle} onClose={onClose} />;
  }
  if (mode.kind === "edit") {
    return (
      <CaseEditor
        initial={caseInputFrom(mode.caseRecord)}
        source={null}
        caseRecord={mode.caseRecord}
        agentId={mode.caseRecord.owner_id}
        onClose={onClose}
      />
    );
  }
  const initial: EvalCaseInputBody = EMPTY_CASE;
  return <CaseEditor initial={initial} source={null} caseRecord={null} agentId={mode.agentId} onClose={onClose} />;
}
