/* PromptModalBody — fullscreen modal body for a prompt block: monospace text +
   a line search. Fixed height so the modal stays stable even when the search
   finds nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { TextInput } from "@devdigest/ui";
import { HighlightedLine } from "./_components/HighlightedLine";

export function PromptModalBody({ text }: { text: string }) {
  const t = useTranslations("runs");
  const [q, setQ] = React.useState("");
  const lines = React.useMemo(() => (text || "—").split("\n"), [text]);
  const ql = q.trim().toLowerCase();
  // Pair each line with its position in the UNFILTERED text so the key stays
  // stable across keystrokes — `shown`'s own index shifts as the filter
  // changes, which is what made `key={i}` unsafe here (`shown` IS filtered).
  const numbered = React.useMemo(() => lines.map((line, idx) => ({ line, idx })), [lines]);
  const shown = ql ? numbered.filter(({ line }) => line.toLowerCase().includes(ql)) : numbered;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "70vh" }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <TextInput
          value={q}
          onChange={setQ}
          placeholder={t("trace.prompt.search")}
          suffix={
            ql ? (
              <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {shown.length} / {lines.length}
              </span>
            ) : undefined
          }
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {ql && shown.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            {t("trace.prompt.noMatches", { q: q.trim() })}
          </div>
        ) : (
          <pre
            className="mono"
            style={{ margin: 0, padding: "16px 24px", whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.6 }}
          >
            {ql
              ? shown.map(({ line, idx }) => <HighlightedLine key={idx} line={line} query={q} />)
              : text || "—"}
          </pre>
        )}
      </div>
    </div>
  );
}
