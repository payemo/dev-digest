/* Route: /repos/:repoId/multi-agent — Multi-Agent Review area landing.
   Redirects to the repo's latest multi-agent run (results for that PR), or to
   Configure run when the repo has none yet. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useLatestRepoMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";

export default function MultiAgentLandingPage() {
  const t = useTranslations("multiAgent");
  const { repoId } = useParams<{ repoId: string }>();
  const router = useRouter();
  const repoNotFound = useRepoNotFound(repoId);
  const latest = useLatestRepoMultiAgentRun(repoNotFound ? null : repoId);

  // Navigation is the side effect here: once the ref resolves, replace this
  // entry so Back does not bounce through the landing.
  React.useEffect(() => {
    if (!latest.isSuccess) return;
    router.replace(
      latest.data
        ? `/repos/${repoId}/multi-agent/${latest.data.pr_number}`
        : `/repos/${repoId}/multi-agent/new`,
    );
  }, [latest.isSuccess, latest.data, repoId, router]);

  const crumb = [{ label: t("crumb.area") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }
  if (latest.isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("results.loadError")}
          body={latest.error instanceof ApiError ? latest.error.message : undefined}
          onRetry={() => latest.refetch()}
        />
      </AppShell>
    );
  }
  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
        <Skeleton height={28} width={420} />
        <Skeleton height={200} />
      </div>
    </AppShell>
  );
}
