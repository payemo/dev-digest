/* /ci-runs — CI Runs: agent reviews executed inside CI, ingested from GitHub
   Actions. The view reads its filters from the URL, so it sits under Suspense. */
"use client";

import React, { Suspense } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { CiRunsView } from "./_components/CiRunsView";

export default function CiRunsPage() {
  const t = useTranslations("ci");
  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <Suspense fallback={<Skeleton height={200} />}>
        <CiRunsView />
      </Suspense>
    </AppShell>
  );
}
