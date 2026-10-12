/* Route: /repos/:repoId/multi-agent/new — Configure run.
   Pick a PR (preselected from ?pr=<number>) and the agents to fan out. */
"use client";

import React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useRepoNotFound } from "@/lib/repo-context";
import { ConfigureRun } from "../_components/ConfigureRun";

export default function ConfigureRunPage() {
  const t = useTranslations("multiAgent");
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const repoNotFound = useRepoNotFound(repoId);
  const pr = Number(search.get("pr"));
  const initialPrNumber = Number.isInteger(pr) && pr > 0 ? pr : null;

  const crumb = [
    { label: t("crumb.area"), href: `/repos/${repoId}/multi-agent` },
    { label: t("crumb.configure") },
  ];
  return (
    <AppShell crumb={crumb}>
      {repoNotFound ? (
        <RepoNotFound />
      ) : (
        // Keyed by ?pr so following "Configure run" from another PR re-seeds the form.
        <ConfigureRun key={initialPrNumber ?? "none"} repoId={repoId} initialPrNumber={initialPrNumber} />
      )}
    </AppShell>
  );
}
