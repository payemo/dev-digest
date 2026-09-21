/* DiffModal — real line-level diff between one earlier version's body and the
   skill's current active body, opened from a Versions-tab row's Diff button. */
"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@devdigest/ui";
import type { SkillVersion } from "@devdigest/shared";
import { computeLineDiff } from "./helpers";
import { s } from "./styles";

export function DiffModal({
  base,
  current,
  onClose,
}: {
  base: SkillVersion;
  current: SkillVersion;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const lines = computeLineDiff(base.body, current.body);
  const hasChanges = lines.some((ln) => ln.kind !== "context");

  return (
    <Modal
      width={840}
      title={t("editor.versions.diffModalTitle")}
      subtitle={t("editor.versions.diffModalSubtitle", { base: base.version, current: current.version })}
      onClose={onClose}
    >
      <div style={s.wrap}>
        {!hasChanges ? (
          <div style={s.empty}>{t("editor.versions.noChanges")}</div>
        ) : (
          lines.map((ln, i) => (
            <div key={i} className="mono" style={s.row(ln.kind)}>
              <span style={s.sign(ln.kind)}>{ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : " "}</span>
              <span style={s.text}>{ln.text || " "}</span>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
