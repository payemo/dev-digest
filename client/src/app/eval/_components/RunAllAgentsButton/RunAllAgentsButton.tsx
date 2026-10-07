/* RunAllAgentsButton — states how many agents and cases will run BEFORE
   starting anything, then starts one background run per agent with cases. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { useRunAllEvals } from "@/lib/hooks/eval";
import { s } from "./styles";

export function RunAllAgentsButton({ agents }: { agents: EvalAgentSummary[] }) {
  const t = useTranslations("eval");
  const runAll = useRunAllEvals();
  const [confirming, setConfirming] = React.useState(false);
  const cases = agents.reduce((n, a) => n + a.cases_total, 0);

  return (
    <>
      <Button kind="primary" icon="Play" disabled={agents.length === 0} onClick={() => setConfirming(true)}>
        {t("dashboard.runAllAgents")}
      </Button>
      {confirming && (
        <Modal
          width={480}
          title={t("dashboard.confirmRunAll", { agents: agents.length, cases })}
          onClose={() => setConfirming(false)}
          footer={
            <div style={s.footer}>
              <Button kind="secondary" onClick={() => setConfirming(false)}>
                {t("modal.cancel")}
              </Button>
              <Button
                kind="primary"
                icon="Play"
                loading={runAll.isPending}
                onClick={() => runAll.mutate(undefined, { onSuccess: () => setConfirming(false) })}
              >
                {t("dashboard.confirm")}
              </Button>
            </div>
          }
        >
          <p style={s.body}>{t("dashboard.confirmRunAllBody")}</p>
          {runAll.error && <p style={s.error}>{runAll.error.message}</p>}
        </Modal>
      )}
    </>
  );
}
