/* IntentBlock — the intent snapshot the brief was generated with: the quoted
   sentence and its In/Out of scope lists. Plain text only — the sentence is
   model output built from untrusted sources. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel } from "@devdigest/ui";
import type { Intent } from "@devdigest/shared";
import { s } from "./styles";

function ScopeColumn({
  title,
  items,
  kind,
}: {
  title: string;
  items: string[];
  kind: "in" | "out";
}) {
  if (items.length === 0) return null;
  const I = kind === "in" ? Icon.Check : Icon.X;
  return (
    <div>
      <div style={s.scopeHeading(kind)}>
        <I size={12} />
        {title}
      </div>
      <ul style={s.scopeList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function IntentBlock({ intent }: { intent: Intent }) {
  const t = useTranslations("brief");
  return (
    <section aria-label={t("block.intent")}>
      <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
      <p style={s.sentence}>“{intent.intent}”</p>
      <div style={s.scopeGrid}>
        <ScopeColumn title={t("inScope")} items={intent.in_scope} kind="in" />
        <ScopeColumn title={t("outOfScope")} items={intent.out_of_scope} kind="out" />
      </div>
    </section>
  );
}
