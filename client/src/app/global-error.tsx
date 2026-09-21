/* Root error boundary (Next.js file convention) — the LAST resort, fired only
   when the root layout itself throws. Must render its own <html>/<body> and
   must not depend on anything the root layout provides (NextIntlClientProvider,
   the theme script, @devdigest/ui's CSS variables) since that's exactly what
   may have just failed. Deliberately plain: no i18n, no design-system import. */
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          fontFamily: "system-ui, sans-serif",
          background: "#0b0e14",
          color: "#e6e6e6",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: 14, color: "#9aa0aa", maxWidth: 380 }}>
          An unexpected error occurred and the app couldn&apos;t render. Try reloading the page.
        </div>
        <button
          onClick={reset}
          style={{
            marginTop: 8,
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #3a3f4b",
            background: "#171b23",
            color: "#e6e6e6",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
