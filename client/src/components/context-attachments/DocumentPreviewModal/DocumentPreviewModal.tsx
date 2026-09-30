/* DocumentPreviewModal — read-only preview of one document's stored content,
   opened from a row's Preview button in the Context tab. There is no edit or
   delete control here: document management lives on the repo's own Project
   Context page, not on an agent's or a skill's attachment list. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, ErrorState, Markdown, Modal, Skeleton } from "@devdigest/ui";
import { useContextDocument } from "@/lib/hooks/project-context";
import { CATEGORY_COLOR } from "../constants";
import { s } from "./styles";

export function DocumentPreviewModal({
  repoId,
  docId,
  onClose,
}: {
  repoId: string;
  docId: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useContextDocument(repoId, docId);

  return (
    <Modal
      width={720}
      title={data?.name ?? t("preview.title")}
      subtitle={data ? `${data.category}/${data.folder ? `${data.folder}/` : ""}` : undefined}
      onClose={onClose}
    >
      <div style={s.wrap}>
        {isLoading && (
          <>
            <Skeleton height={18} width="40%" />
            <Skeleton height={140} />
          </>
        )}

        {isError && <ErrorState body={t("preview.loadError")} onRetry={() => void refetch()} />}

        {data && (
          <>
            <div style={s.header}>
              <Badge color={CATEGORY_COLOR[data.category]} mono>
                {data.category}
              </Badge>
              {data.availability === "missing" && (
                <Badge color="var(--crit)" icon="AlertTriangle">
                  {t("doc.missing")}
                </Badge>
              )}
              <span className="mono" style={s.path}>
                {data.path}
              </span>
            </div>
            <p style={s.readOnly}>{t("preview.readOnly")}</p>
            <div style={s.body}>
              <Markdown>{data.content}</Markdown>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
