/* EvalCaseRow — one case of the set: last-result icon, name, kind badge,
   "expected N, got M", the expectation chip (or "assert empty"), and
   run / edit / delete. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, IconBtn } from "@devdigest/ui";
import type { EvalCaseRecord } from "@devdigest/shared";
import { expectationChip } from "../../helpers";
import { s } from "./styles";

const STATUS = {
  passed: { icon: "CheckCircle", color: "var(--ok)" },
  failed: { icon: "XCircle", color: "var(--crit)" },
  errored: { icon: "AlertTriangle", color: "var(--warn)" },
  never: { icon: "Clock", color: "var(--text-muted)" },
} as const;

export function EvalCaseRow({
  c,
  running,
  onRun,
  onEdit,
  onDelete,
}: {
  c: EvalCaseRecord;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const status = c.last_result?.status ?? "never";
  const meta = STATUS[status];
  const I = Icon[meta.icon];
  const chip = expectationChip(c);
  const mustFind = c.kind === "must_find";
  return (
    <div style={s.row} data-testid="eval-case-row">
      <span title={t(`cases.status.${status}`)} style={{ display: "inline-flex" }}>
        <I size={16} style={{ color: meta.color }} aria-label={t(`cases.status.${status}`)} />
      </span>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span className="mono" style={s.name}>
            {c.name}
          </span>
          <Badge
            color={mustFind ? "var(--accent-text)" : "var(--text-secondary)"}
            bg={mustFind ? "var(--accent-bg)" : "var(--bg-hover)"}
            style={s.kindBadge}
          >
            {mustFind ? t("kind.mustFind") : t("kind.mustNotFlag")}
          </Badge>
          {c.source_finding_id && !c.source_available && (
            <span style={s.sub}>{t("modal.sourceUnavailable")}</span>
          )}
        </div>
        <div style={s.sub}>
          {c.last_result
            ? c.last_result.status === "errored"
              ? t("modal.lastRunErrored", { reason: c.last_result.reason ?? "" })
              : t("cases.expectedGot", { expected: c.last_result.expected_n, got: c.last_result.got_m })
            : t("cases.neverRun")}
        </div>
      </div>
      <Badge style={s.chip}>{chip ?? t("modal.assertEmpty")}</Badge>
      <div style={s.actions}>
        {running ? (
          <Icon.RefreshCw size={14} style={{ animation: "ddspin 1s linear infinite", color: "var(--text-muted)", margin: 8 }} />
        ) : (
          <IconBtn icon="Play" label={t("cases.run")} size={28} onClick={onRun} />
        )}
        <IconBtn icon="Edit" label={t("cases.edit")} size={28} onClick={onEdit} />
        <IconBtn icon="Trash" label={t("cases.delete")} size={28} onClick={onDelete} />
      </div>
    </div>
  );
}
