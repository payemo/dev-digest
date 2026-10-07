/* ExpectedOutputEditor — the expected-output JSON with a live valid/invalid
   badge, validated against the shared expectation shape + kind rule, the
   "Finding skeleton" button, and (must_not_flag) the forbidden location. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, TextInput, Textarea } from "@devdigest/ui";
import type { EvalExpectationKind } from "@devdigest/shared";
import { EXPECTED_ROWS } from "../../constants";
import { insertSkeleton, parseExpected, type CaseFormState } from "../../helpers";
import { s as modal } from "../../styles";
import { s } from "./styles";

export function ExpectedOutputEditor({
  kind,
  text,
  diff,
  readOnly,
  forbidden,
  showForbidden,
  onText,
  onForbidden,
}: {
  kind: EvalExpectationKind;
  text: string;
  diff: string;
  readOnly: boolean;
  forbidden: CaseFormState["forbidden"];
  showForbidden: boolean;
  onText: (v: string) => void;
  onForbidden: (v: CaseFormState["forbidden"]) => void;
}) {
  const t = useTranslations("eval");
  const parsed = parseExpected(text, kind);
  const jsonValid = parsed.ok || parsed.error !== "invalid_json";
  const assertEmpty = kind === "must_not_flag" && parsed.ok && parsed.value.length === 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={modal.label}>
          {kind === "must_not_flag" ? t("modal.expectedNone") : t("caseEditor.expectedOutput")}
        </span>
        {assertEmpty ? (
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {t("modal.assertEmpty")}
          </Badge>
        ) : jsonValid ? (
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {t("caseEditor.validJson")}
          </Badge>
        ) : (
          <Badge color="var(--crit)" bg="var(--crit-bg)" icon="X">
            {t("caseEditor.invalidJson")}
          </Badge>
        )}
        {!readOnly && (
          <div style={s.right}>
            <Button kind="secondary" size="sm" icon="Plus" onClick={() => onText(insertSkeleton(text, diff))}>
              {t("modal.findingSkeleton")}
            </Button>
          </div>
        )}
      </div>

      {readOnly ? (
        <pre className="mono" style={modal.pre} data-testid="eval-expected-readonly">
          {text}
          {kind === "must_not_flag" && `  ${t("modal.expectedNoneComment")}`}
        </pre>
      ) : (
        <Textarea value={text} onChange={onText} rows={EXPECTED_ROWS} mono />
      )}

      {!parsed.ok && parsed.error === "wrong_shape" && <div style={modal.fieldError}>{t("modal.wrongShape")}</div>}
      {!parsed.ok && parsed.error === "kind_rule" && <div style={modal.fieldError}>{t("modal.kindRule")}</div>}

      {showForbidden && (
        <div style={s.forbidden}>
          <div style={modal.label}>{t("modal.forbiddenLabel")}</div>
          <div style={s.hint}>{t("modal.forbiddenHint")}</div>
          <div style={s.forbiddenRow}>
            <div style={{ flex: 2 }}>
              <TextInput
                mono
                aria-label={t("modal.forbiddenFile")}
                placeholder={t("modal.filePathPlaceholder")}
                value={forbidden.file}
                onChange={(v) => onForbidden({ ...forbidden, file: v })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput
                type="number"
                aria-label={t("modal.forbiddenStart")}
                placeholder={t("modal.forbiddenStart")}
                value={forbidden.start}
                onChange={(v) => onForbidden({ ...forbidden, start: v })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput
                type="number"
                aria-label={t("modal.forbiddenEnd")}
                placeholder={t("modal.forbiddenEnd")}
                value={forbidden.end}
                onChange={(v) => onForbidden({ ...forbidden, end: v })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
