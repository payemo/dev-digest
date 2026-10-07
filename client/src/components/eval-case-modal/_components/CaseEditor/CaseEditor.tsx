/* CaseEditor — the eval-case form shared by every modal mode: a case seeded
   from a finding (input frozen, saved with no edits needed), a hand-made new
   case, or an existing case. Save is refused while the name is empty or the
   expected output is invalid JSON / the wrong shape / breaks the kind rule;
   with "Run on save" on, saving also runs the case and shows its result. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, TextInput, Toggle } from "@devdigest/ui";
import type { EvalCaseInputBody, EvalCaseRecord, EvalCaseResult, EvalSourceDecision } from "@devdigest/shared";
import {
  useCreateCaseFromFinding,
  useCreateEvalCase,
  useRunEvalCase,
  useUpdateEvalCase,
} from "@/lib/hooks/eval";
import { MODAL_WIDTH } from "../../constants";
import { bannerLocation, formStateFrom, parseExpected, validateForm, type CaseFormState } from "../../helpers";
import { s } from "../../styles";
import { CaseBanner } from "../CaseBanner";
import { ExpectedOutputEditor } from "../ExpectedOutputEditor";
import { InputTabs } from "../InputTabs";
import { LastRunLine } from "../LastRunLine";

export interface CaseEditorProps {
  initial: EvalCaseInputBody;
  /** Set when saving creates the case from a finding (input re-frozen server-side). */
  source: { findingId: string; decision: EvalSourceDecision } | null;
  /** Set when editing a saved case. */
  caseRecord: EvalCaseRecord | null;
  /** Owner agent for a new hand-made case. */
  agentId: string | null;
  /** Title of the source finding, for the negative banner (not part of the case). */
  findingTitle?: string;
  onClose: () => void;
}

export function CaseEditor({ initial, source, caseRecord, agentId, findingTitle, onClose }: CaseEditorProps) {
  const t = useTranslations("eval");
  const [form, setForm] = React.useState<CaseFormState>(() => formStateFrom(initial));
  const [savedId, setSavedId] = React.useState<string | null>(caseRecord?.id ?? null);
  const [runOnSave, setRunOnSave] = React.useState(true);
  const [lastResult, setLastResult] = React.useState<EvalCaseResult | null>(caseRecord?.last_result ?? null);

  const createFromFinding = useCreateCaseFromFinding();
  const createCase = useCreateEvalCase(agentId ?? caseRecord?.owner_id ?? "");
  const updateCase = useUpdateEvalCase();
  const runCase = useRunEvalCase();
  const pending = createFromFinding.isPending || createCase.isPending || updateCase.isPending || runCase.isPending;
  const error = createFromFinding.error ?? createCase.error ?? updateCase.error ?? runCase.error;

  const frozen = !!source || !!caseRecord?.source_finding_id;
  const decision = source?.decision ?? caseRecord?.source_decision ?? null;
  const validation = validateForm(form);
  const expected = parseExpected(form.expectedText, form.kind);
  const banner = bannerLocation({
    kind: form.kind,
    expected_output: expected.ok ? expected.value : [],
    forbidden_location: initial.forbidden_location ?? null,
  });
  const set = (patch: Partial<CaseFormState>) => setForm((f) => ({ ...f, ...patch }));

  /** Create or update the case; returns its id. */
  async function persist(): Promise<string | null> {
    if (!validation.ok) return null;
    const input = validation.input;
    if (savedId) {
      await updateCase.mutateAsync({ caseId: savedId, input });
      return savedId;
    }
    const record = source
      ? await createFromFinding.mutateAsync({
          findingId: source.findingId,
          overrides: {
            name: input.name,
            ...(input.notes ? { notes: input.notes } : {}),
            ...(input.kind === "must_find" ? { expected_output: input.expected_output } : {}),
          },
        })
      : await createCase.mutateAsync(input);
    setSavedId(record.id);
    return record.id;
  }

  async function save(run: boolean) {
    try {
      const id = await persist();
      if (!id) return;
      if (run) setLastResult(await runCase.mutateAsync(id));
      else onClose();
    } catch {
      /* surfaced through the mutation's `error` below */
    }
  }

  const subtitle = decision ? t("modal.seededFrom", { decision }) : t("modal.handMadeNoAgent");
  const footer = (
    <div style={s.footer}>
      <label style={s.toggleLabel}>
        <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
        {t("modal.runOnSave")}
      </label>
      <div style={s.footerSpacer} />
      {error && <span style={s.error}>{t("modal.saveError", { message: error.message })}</span>}
      <Button kind="secondary" onClick={onClose}>
        {t("modal.cancel")}
      </Button>
      <Button kind="secondary" icon="Play" disabled={!validation.ok || pending} onClick={() => save(true)}>
        {runCase.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
      </Button>
      <Button kind="primary" icon="Check" disabled={!validation.ok || pending} onClick={() => save(runOnSave)}>
        {pending && !runCase.isPending ? t("caseEditor.saving") : t("caseEditor.save")}
      </Button>
    </div>
  );

  return (
    <Modal
      width={MODAL_WIDTH}
      title={form.name.trim() ? t("modal.title", { name: form.name.trim() }) : t("modal.newTitle")}
      subtitle={subtitle}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.grid}>
        <div style={s.left}>
          {frozen && (
            <CaseBanner
              kind={form.kind}
              title={form.kind === "must_find" ? banner.title : (findingTitle ?? null)}
              location={banner.location}
            />
          )}
          <div>
            <label style={s.label} htmlFor="eval-case-name">
              {t("caseEditor.nameLabel")}
              <span style={s.required}>*</span>
            </label>
            <TextInput
              id="eval-case-name"
              mono
              value={form.name}
              placeholder={t("caseEditor.namePlaceholder")}
              onChange={(v) => set({ name: v })}
            />
            {!form.name.trim() && <div style={s.fieldError}>{t("modal.nameRequired")}</div>}
          </div>
          {!frozen && (
            <div>
              <div style={s.label}>{t("modal.kindLabel")}</div>
              <div style={s.kindRow} role="radiogroup" aria-label={t("modal.kindLabel")}>
                {(["must_find", "must_not_flag"] as const).map((k) => (
                  <Button
                    key={k}
                    kind="tertiary"
                    size="sm"
                    active={form.kind === k}
                    role="radio"
                    aria-checked={form.kind === k}
                    onClick={() => set({ kind: k })}
                  >
                    {k === "must_find" ? t("kind.mustFind") : t("kind.mustNotFlag")}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <InputTabs
            diff={form.diff}
            files={form.files}
            meta={form.meta}
            readOnly={frozen}
            onDiff={(diff) => set({ diff })}
            onFiles={(files) => set({ files })}
            onMeta={(meta) => set({ meta })}
          />
        </div>
        <div style={s.right}>
          <ExpectedOutputEditor
            kind={form.kind}
            text={form.expectedText}
            diff={form.diff}
            readOnly={frozen && form.kind === "must_not_flag"}
            forbidden={form.forbidden}
            showForbidden={!frozen && form.kind === "must_not_flag"}
            onText={(expectedText) => set({ expectedText })}
            onForbidden={(forbidden) => set({ forbidden })}
          />
          {lastResult && <LastRunLine result={lastResult} />}
        </div>
      </div>
    </Modal>
  );
}
