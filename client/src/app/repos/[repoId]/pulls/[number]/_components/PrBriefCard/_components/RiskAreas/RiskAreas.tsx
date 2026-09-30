/* RiskAreas — one expandable chip per verified risk: severity icon, title and
   its first file ref; expanding shows the explanation and every ref, each of
   which deep-links into the Files changed tab. All text is plain text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { SEVERITY_META } from "../../constants";
import { parseRef } from "../../helpers";
import { s } from "./styles";

interface RiskAreasProps {
  risks: Risk[];
  onOpenInDiff: (file: string, line: number | null) => void;
}

function RiskChip({ risk, onOpenInDiff }: { risk: Risk; onOpenInDiff: RiskAreasProps["onOpenInDiff"] }) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState(false);
  const meta = SEVERITY_META[risk.severity];
  const SevIcon = Icon[meta.icon];
  const toggle = () => setOpen((v) => !v);
  return (
    // A labelled region per chip, so its header (role="button") is queryable
    // apart from the diff viewer's file headers and the blast tree's rows.
    <section aria-label={risk.title} style={s.chip}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${t(`severity.${risk.severity}`)}: ${risk.title}`}
        style={s.chipHeader}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span style={s.sevIcon(meta.color)} title={t(`severity.${risk.severity}`)}>
          <SevIcon size={13} />
        </span>
        <span style={s.chipText}>
          <span style={s.chipTitle}>{risk.title}</span>
          {risk.file_refs[0] && (
            <span className="mono" style={s.firstRef}>
              {risk.file_refs[0]}
            </span>
          )}
        </span>
        <span style={s.chevron(open)}>
          <Icon.ChevronDown size={14} />
        </span>
      </div>
      {open && (
        <div style={s.chipBody}>
          <p style={s.explanation}>{risk.explanation}</p>
          <div style={s.refList}>
            {risk.file_refs.map((ref) => {
              const { path, line } = parseRef(ref);
              return (
                <button key={ref} type="button" className="mono" style={s.refButton} onClick={() => onOpenInDiff(path, line)}>
                  {ref}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function RiskAreas({ risks, onOpenInDiff }: RiskAreasProps) {
  const t = useTranslations("brief");
  return (
    <section aria-label={t("block.risks")}>
      <SectionLabel icon="AlertTriangle">{t("block.risks")}</SectionLabel>
      {risks.length === 0 ? (
        <p style={s.empty}>{t("noRisks")}</p>
      ) : (
        <div style={s.grid}>
          {risks.map((risk) => (
            <RiskChip key={`${risk.kind}:${risk.title}:${risk.file_refs.join(",")}`} risk={risk} onOpenInDiff={onOpenInDiff} />
          ))}
        </div>
      )}
    </section>
  );
}
