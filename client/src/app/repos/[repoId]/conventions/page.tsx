/* Route: /repos/:repoId/conventions — the Conventions Extractor.
   Scan the cloned repo for house-rules, triage the candidates, and merge the
   accepted ones into a skill. Every candidate on this page has already passed
   the server's evidence gate, so the snippets shown are real repo bytes. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Chip, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useConventions, useExtractConventions } from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { FILTERS, SKELETON_CARDS, type ConventionFilter } from "./constants";
import { countByStatus, filterCandidates } from "./helpers";
import { s } from "./styles";

export default function ConventionsPage() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions();

  const [filter, setFilter] = React.useState<ConventionFilter>("pending");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [lastScanned, setLastScanned] = React.useState(false);

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");
  const all = candidates ?? [];
  const counts = countByStatus(all);
  const visible = filterCandidates(all, filter);
  const scanned = all.length > 0 || lastScanned;

  const runScan = () => {
    if (extract.isPending) return; // guard a double-click firing two scans
    setScanError(null);
    extract.mutate(repoId, {
      onSuccess: (result) => {
        setLastScanned(true);
        setFilter(result.candidates.some((c) => c.status === "pending") ? "pending" : "all");
      },
      onError: (err) => {
        setScanError(err instanceof ApiError ? err.message : t("page.extractionFailed"));
      },
    });
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {modalOpen && (
          <CreateSkillModal
            repoId={repoId}
            repoName={repoName}
            approvedCount={counts.approved}
            onClose={() => setModalOpen(false)}
          />
        )}

        <div style={s.headerRow}>
          <div>
            <h1 style={s.heading}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          {scanned && (
            <Button
              kind="secondary"
              icon="RefreshCw"
              onClick={runScan}
              loading={extract.isPending}
              disabled={extract.isPending}
            >
              {extract.isPending ? t("page.scanning") : t("page.rescan")}
            </Button>
          )}
        </div>

        {isLoading && (
          <div style={s.cardList}>
            {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
              <div key={i} style={s.skeletonCard}>
                <Skeleton height={16} width="60%" />
                <Skeleton height={40} />
                <Skeleton height={10} width="30%" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && isError && (
          <ErrorState title={t("page.loadError")} onRetry={() => refetch()} />
        )}

        {!isLoading && !isError && !scanned && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runScan}
            ctaLoading={extract.isPending}
          />
        )}

        {!isLoading && !isError && scanned && all.length === 0 && (
          <div style={s.noValidWrap}>
            <ErrorState
              title={t("page.noValid.title")}
              body={scanError ?? t("page.noValid.body")}
              onRetry={runScan}
            />
          </div>
        )}

        {!isLoading && !isError && all.length > 0 && (
          <>
            <div style={s.toolbar}>
              <div style={s.filters}>
                {FILTERS.map((f) => (
                  <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                    {t(f.labelKey)} · {f.key === "all" ? counts.total : counts[f.key]}
                  </Chip>
                ))}
              </div>
              <Button
                kind="primary"
                icon="Sparkles"
                onClick={() => setModalOpen(true)}
                disabled={counts.approved === 0}
                title={counts.approved === 0 ? t("page.createSkillDisabledHint") : undefined}
              >
                {t("page.createSkill")}
              </Button>
            </div>

            {scanError && (
              <ErrorState title={t("page.extractionFailed")} body={scanError} onRetry={runScan} />
            )}

            <div style={s.cardList}>
              {visible.map((c) => (
                <ConventionCard
                  key={c.id}
                  repoId={repoId}
                  repoFullName={activeRepo?.full_name ?? ""}
                  defaultBranch={activeRepo?.default_branch ?? "main"}
                  candidate={c}
                />
              ))}
              {visible.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("page.filterEmpty")}</p>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
