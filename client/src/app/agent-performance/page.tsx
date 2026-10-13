/* /agent-performance — Agent Performance: per-agent runs, cost and accept rate
   over a period. The view reads its period from the URL, so it sits under
   Suspense. */
"use client";

import React, { Suspense } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { AgentPerformanceView } from "./_components/AgentPerformanceView";

export default function AgentPerformancePage() {
  const t = useTranslations("agentPerformance");
  return (
    <AppShell crumb={[{ label: t("crumb") }]}>
      <Suspense fallback={<Skeleton height={200} />}>
        <AgentPerformanceView />
      </Suspense>
    </AppShell>
  );
}
