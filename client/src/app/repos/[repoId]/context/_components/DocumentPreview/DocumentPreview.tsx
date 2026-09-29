/* DocumentPreview — read-only rendering of one document's stored snapshot.
   There is no edit control: documents are not editable in the studio, and a
   Save button next to text that is never written back would be a lie. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { useContextDocument, useDeleteContextDocument } from "@/lib/hooks/project-context";
import { Button } from "@devdigest/ui";
import { CATEGORY_COLOR } from "../../constants";
import { s } from "./styles";

export function DocumentPreview({
  repoId,
  docId,
}: {
  repoId: string;
  docId: string | null;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useContextDocument(repoId, docId);
  const remove = useDeleteContextDocument();

  if (!docId) {
    return (
      <div style={s.wrap}>
        <EmptyState icon="FileText" title={t("preview.title")} body={t("preview.empty")} />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={18} width="40%" />
        <Skeleton height={140} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div style={s.wrap}>
        <ErrorState body={t("preview.loadError")} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span className="mono" style={s.path}>
          {data.path}
        </span>
        <Badge color={CATEGORY_COLOR[data.category]} mono>
          {data.category}
        </Badge>
        <Badge color="var(--text-secondary)">{t(`origin.${data.origin}`)}</Badge>
        {data.availability === "missing" && (
          <Badge color="var(--crit)" icon="AlertTriangle">
            {t("doc.missing")}
          </Badge>
        )}
        <span style={s.headerRight}>
          {t("doc.usedByAgents", { count: data.used_by_agents })}
          {/* Only a document added here can be deleted — a discovered file
              would simply come back on the next refresh. */}
          {data.origin === "user" && (
            <Button
              kind="ghost"
              size="sm"
              icon="Trash"
              loading={remove.isPending}
              onClick={() => {
                if (!window.confirm(t("delete.confirm", { name: data.name }))) return;
                remove.mutate({ repoId, docId: data.id });
              }}
            >
              {t("delete.action")}
            </Button>
          )}
        </span>
      </div>

      {data.availability === "missing" && <p style={s.notice}>{t("doc.missingHint")}</p>}
      <p style={s.readOnly}>{t("preview.readOnly")}</p>

      <div style={s.body}>
        <Markdown>{data.content}</Markdown>
      </div>
    </div>
  );
}
