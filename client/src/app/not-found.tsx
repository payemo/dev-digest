/* App-level 404 (Next.js file convention) — renders for any route segment
   with no matching page.tsx. Follows the same AppShell + EmptyState shape as
   RepoNotFound (src/components/repo-not-found), the closest existing pattern
   for "nothing to show here, here's the way back". */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";

export default function NotFound() {
  const t = useTranslations("common");
  const router = useRouter();
  return (
    <AppShell>
      <EmptyState
        icon="AlertTriangle"
        title={t("notFound.title")}
        body={t("notFound.body")}
        cta={t("notFound.cta")}
        onCta={() => router.push("/")}
      />
    </AppShell>
  );
}
