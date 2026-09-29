/* DocumentList — the repository's documents, grouped by category. Selection
   drives the preview pane; the list itself owns no data. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, SectionLabel } from "@devdigest/ui";
import type { ContextDocument } from "@/lib/types";
import { CATEGORY_COLOR } from "../../constants";
import { groupByCategory } from "../../helpers";
import { s } from "./styles";

export function DocumentList({
  documents,
  selectedId,
  onSelect,
}: {
  documents: ContextDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("context");
  const groups = groupByCategory(documents);

  return (
    <div style={s.wrap}>
      {groups.map((group) => (
        <section key={group.category} aria-label={t(`category.${group.category}`)} style={s.group}>
          <SectionLabel>{t(`category.${group.category}`)}</SectionLabel>
          {group.documents.map((doc) => {
            const selected = doc.id === selectedId;
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => onSelect(doc.id)}
                aria-current={selected}
                style={selected ? s.rowSelected : s.row}
              >
                <span className="mono" style={s.name}>
                  {doc.name}
                </span>
                <span className="mono" style={s.folder}>
                  {doc.folder ? `${doc.folder}/` : t("doc.folderRoot")}
                </span>
                <span style={s.badges}>
                  {doc.availability === "missing" && (
                    <Badge color="var(--crit)" icon="AlertTriangle">
                      {t("doc.missing")}
                    </Badge>
                  )}
                  <Badge color={CATEGORY_COLOR[doc.category]} mono>
                    {t(`origin.${doc.origin}`)}
                  </Badge>
                </span>
                <span style={s.meta}>
                  {t("tokens.approx", { count: doc.token_count })} ·{" "}
                  {t("doc.usedByAgents", { count: doc.used_by_agents })}
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
