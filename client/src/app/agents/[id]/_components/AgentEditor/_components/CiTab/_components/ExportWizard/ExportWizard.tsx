/* ExportWizard — "Add to CI": Target → Preview → Configure → Install.
   Every file is generated server-side; the client only previews them, may
   edit the workflow, and either asks the server to open a PR on devdigest/ci
   or zips the returned files for a manual install. Portaled to <body> like
   EvalCaseModal, so no ancestor's overflow/opacity affects the overlay. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent, CiPostAs, CiTrigger } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useActiveRepo } from "@/lib/repo-context";
import { useCiPreview, useExportCi } from "@/lib/hooks/ci";
import { TargetStep } from "./_components/TargetStep";
import { PreviewStep } from "./_components/PreviewStep";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep, type InstallAction, type InstallResult } from "./_components/InstallStep";
import { DEFAULT_TRIGGERS, STEP_CONFIGURE, STEP_INSTALL, STEP_KEYS, STEP_PREVIEW } from "./constants";
import { blockingFromError, buildZip, downloadBytes, toggleTrigger, zipFileName } from "./helpers";
import { s } from "./styles";

type WizardProps = { agent: Agent; onClose: () => void };

function errorText(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    const blocking = blockingFromError(err.details);
    return blocking.length > 0 ? blocking.map((b) => b.message).join(" ") : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function WizardContent({ agent, onClose }: WizardProps) {
  const t = useTranslations("ci");
  const { repos, activeRepo } = useActiveRepo();
  const preview = useCiPreview(agent.id);
  const exportCi = useExportCi(agent.id);

  const [step, setStep] = React.useState(0);
  const [pickedRepo, setPickedRepo] = React.useState<string | null>(null);
  const [triggers, setTriggers] = React.useState<CiTrigger[]>([...DEFAULT_TRIGGERS]);
  const [postAs, setPostAs] = React.useState<CiPostAs>("github_review");
  const [workflowYaml, setWorkflowYaml] = React.useState<string | null>(null);
  const [action, setAction] = React.useState<InstallAction>("open_pr");
  const [result, setResult] = React.useState<InstallResult | null>(null);
  const [installError, setInstallError] = React.useState<string | null>(null);

  // Default to the shell's active repo, else the first imported one.
  const repo = pickedRepo ?? activeRepo?.full_name ?? repos[0]?.full_name ?? "";
  const pastTarget = step >= STEP_PREVIEW;
  const triggersKey = triggers.join(",");

  // Regenerate the preview on entering Preview and whenever an input changes.
  const { mutate: runPreview } = preview;
  React.useEffect(() => {
    if (!pastTarget || !repo || triggersKey === "") return;
    runPreview({
      repo,
      target: "gha",
      post_as: postAs,
      triggers: triggersKey.split(",") as CiTrigger[],
    });
  }, [pastTarget, repo, triggersKey, postAs, runPreview]);

  // Escape closes the dialog.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Trigger/post-as changes regenerate the workflow; confirm before dropping edits. */
  const guardEdits = (apply: () => void) => {
    if (workflowYaml != null && !window.confirm(t("exportWizard.confirmRegenerate"))) return;
    setWorkflowYaml(null);
    apply();
  };

  const blocked = (preview.data?.blocking.length ?? 0) > 0;
  const canContinue =
    step === 0
      ? repo !== ""
      : step === STEP_PREVIEW
        ? !!preview.data && !preview.isPending && !blocked
        : step === STEP_CONFIGURE
          ? triggers.length > 0 && !blocked
          : false;

  const install = async () => {
    setInstallError(null);
    try {
      const res = await exportCi.mutateAsync({
        repo,
        target: "gha",
        action,
        post_as: postAs,
        triggers,
        workflow_yaml: workflowYaml,
      });
      if (action === "files") {
        downloadBytes(buildZip(res.files), zipFileName(res.files));
        setResult({ kind: "zip" });
      } else {
        setResult({ kind: "pr", prUrl: res.pr_url });
      }
    } catch (err) {
      setInstallError(errorText(err));
    }
  };

  const footer = result ? (
    <div style={s.footer}>
      <span style={s.spacer} />
      <Button kind="primary" onClick={onClose}>
        {t("exportWizard.done")}
      </Button>
    </div>
  ) : (
    <div style={s.footer}>
      {step > 0 && (
        <Button icon="ChevronLeft" onClick={() => setStep(step - 1)} disabled={exportCi.isPending}>
          {t("exportWizard.back")}
        </Button>
      )}
      <span style={s.spacer} />
      {step < STEP_INSTALL ? (
        <Button kind="primary" iconRight="ArrowRight" disabled={!canContinue} onClick={() => setStep(step + 1)}>
          {t("exportWizard.continue")}
        </Button>
      ) : (
        <Button
          kind="primary"
          icon="Check"
          loading={exportCi.isPending}
          disabled={exportCi.isPending || blocked}
          onClick={install}
        >
          {exportCi.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      width={720}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.steps}>
        <ExportWizardSteps step={step} labels={STEP_KEYS.map((k) => t(`exportWizard.steps.${k}`))} />
      </div>
      <div style={s.body}>
        {step === 0 && (
          <TargetStep target="gha" repo={repo} repos={repos} onRepo={setPickedRepo} />
        )}
        {step === STEP_PREVIEW && (
          <PreviewStep
            preview={preview.data}
            loading={preview.isPending}
            error={preview.isError ? (errorText(preview.error) ?? t("exportWizard.previewError")) : null}
            workflowYaml={workflowYaml}
            onWorkflowChange={setWorkflowYaml}
            onWorkflowReset={() => setWorkflowYaml(null)}
          />
        )}
        {step === STEP_CONFIGURE && (
          <ConfigureStep
            triggers={triggers}
            postAs={postAs}
            onToggleTrigger={(tr) => guardEdits(() => setTriggers((cur) => toggleTrigger(cur, tr)))}
            onPostAs={(p) => p !== postAs && guardEdits(() => setPostAs(p))}
          />
        )}
        {step === STEP_INSTALL && (
          <InstallStep
            repo={repo}
            fileCount={preview.data?.files.length ?? 0}
            secretNames={preview.data?.secret_names ?? []}
            action={action}
            onAction={setAction}
            error={installError}
            result={result}
          />
        )}
      </div>
    </Modal>
  );
}

export function ExportWizard(props: WizardProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<WizardContent {...props} />, document.body);
}
