/* Route: /repos/:repoId/context — Project Context.
   Every Markdown document this repository carries under .devdigest/, plus the
   ones added here. Read-only: the page shows what an agent would be handed,
   and attaching happens on the agent's or the skill's own Context tab. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useContextDocuments, useContextStatus, useRefreshContext } from "@/lib/hooks/project-context";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { DocumentList } from "./_components/DocumentList";
import { DocumentPreview } from "./_components/DocumentPreview";
import { SyncStatusFooter } from "./_components/SyncStatusFooter";
import { CreateDocumentModal } from "./_components/CreateDocumentModal";
import { SKELETON_ROWS } from "./constants";
import { filterDocuments } from "./helpers";
import { s } from "./styles";

export default function ProjectContextPage() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const documents = useContextDocuments(repoId);
  const status = useContextStatus(repoId);
  const refresh = useRefreshContext();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  const crumb = [{ label: t("crumbWorkspace") }, { label: t("title") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const all = documents.data ?? [];
  const visible = filterDocuments(all, query);
  // A selection that survived a refresh into a document that no longer exists
  // resolves to "nothing selected" rather than a stale preview.
  const selected = all.some((d) => d.id === selectedId) ? selectedId : null;

  const runRefresh = () => {
    if (refresh.isPending) return;
    setRefreshError(null);
    refresh.mutate(repoId, {
      onError: (err) =>
        setRefreshError(err instanceof ApiError ? err.message : t("loadError")),
    });
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {createOpen && (
          <CreateDocumentModal repoId={repoId} onClose={() => setCreateOpen(false)} />
        )}

        <div style={s.headerRow}>
          <div>
            <h1 style={s.heading}>
              {t("title")}
              <span className="mono" style={s.repoName}>
                {activeRepo?.full_name ?? t("repoFallback")}
              </span>
            </h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>
          <div style={s.actions}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              onClick={runRefresh}
              loading={refresh.isPending}
              disabled={refresh.isPending}
            >
              {refresh.isPending ? t("refreshing") : t("refresh")}
            </Button>
            <Button kind="primary" icon="Plus" onClick={() => setCreateOpen(true)}>
              {t("create")}
            </Button>
          </div>
        </div>

        {refreshError && <p style={s.errorRow}>{refreshError}</p>}

        {documents.isLoading && (
          <div style={s.leftCol}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={34} />
            ))}
          </div>
        )}

        {!documents.isLoading && documents.isError && (
          <ErrorState title={t("loadError")} onRetry={() => void documents.refetch()} />
        )}

        {!documents.isLoading && !documents.isError && all.length === 0 && (
          <EmptyState
            icon="FileText"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("refresh")}
            onCta={runRefresh}
            ctaLoading={refresh.isPending}
          />
        )}

        {!documents.isLoading && !documents.isError && all.length > 0 && (
          <div style={s.split}>
            <div style={s.leftCol}>
              <TextInput
                value={query}
                onChange={setQuery}
                placeholder={t("attach.filterPlaceholder")}
                aria-label={t("attach.filterPlaceholder")}
              />
              <DocumentList
                documents={visible}
                selectedId={selected}
                onSelect={setSelectedId}
              />
              {status.data && <SyncStatusFooter status={status.data} />}
            </div>
            <DocumentPreview repoId={repoId} docId={selected} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
