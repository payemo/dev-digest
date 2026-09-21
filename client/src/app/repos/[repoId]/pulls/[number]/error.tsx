/* Segment-level error boundary for the PR detail page — the one route with
   an SSE subscription (live run events) and a trace drawer, both realistic
   places for a render-time throw that the app-level error.tsx would also
   catch but with a less useful "go back" target (the PR list, not home). */
"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";

export default function PrDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  const tPr = useTranslations("prReview");
  const params = useParams<{ repoId: string; number: string }>();
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const prListLabel = tPr("list.breadcrumb");

  return (
    <AppShell crumb={[{ label: prListLabel, href: `/repos/${params.repoId}/pulls` }, { label: `#${params.number}`, mono: true }]}>
      <ErrorState fullScreen title={t("crash.title")} body={t("crash.body")} onRetry={reset} />
      <div style={{ display: "flex", justifyContent: "center", marginTop: -8, paddingBottom: 24 }}>
        <Button kind="ghost" size="sm" onClick={() => router.push(`/repos/${params.repoId}/pulls`)}>
          {t("crash.backTo", { label: prListLabel })}
        </Button>
      </div>
    </AppShell>
  );
}
