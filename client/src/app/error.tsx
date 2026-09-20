/* App-level error boundary (Next.js file convention). Catches any render-time
   throw below the root layout that no closer error.tsx already caught. Still
   inside the root layout, so NextIntlClientProvider/AppShell are available —
   contrast with global-error.tsx, which replaces the root layout itself and
   can't assume either. */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  const router = useRouter();

  useEffect(() => {
    // No error-tracking service wired up yet — at least land it in the
    // console so it isn't silently swallowed by the boundary.
    console.error(error);
  }, [error]);

  return (
    <AppShell>
      <ErrorState fullScreen title={t("crash.title")} body={t("crash.body")} onRetry={reset} />
      <div className="flex justify-center -mt-2 pb-6">
        <Button kind="ghost" size="sm" onClick={() => router.push("/")}>
          {t("crash.home")}
        </Button>
      </div>
    </AppShell>
  );
}
