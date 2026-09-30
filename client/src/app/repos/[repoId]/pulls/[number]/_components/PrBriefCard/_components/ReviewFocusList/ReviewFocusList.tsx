/* ReviewFocusList — "read these first": the verified focus items in the model's
   order, each a button that deep-links to its file and line in the Files
   changed tab. The reason is plain text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Card, SectionLabel } from "@devdigest/ui";
import type { ReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

interface ReviewFocusListProps {
  items: ReviewFocusItem[];
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function ReviewFocusList({ items, onOpenInDiff }: ReviewFocusListProps) {
  const t = useTranslations("brief");
  return (
    <Card>
      <section aria-label={t("reviewFocus.heading")}>
        <SectionLabel icon="ListChecks">
          <span style={s.heading}>
            {t("reviewFocus.heading")}
            <Badge color="var(--accent-text)" bg="var(--accent-bg)">
              {items.length}
            </Badge>
          </span>
        </SectionLabel>
        {items.length === 0 ? (
          <p style={s.empty}>{t("reviewFocus.empty")}</p>
        ) : (
          <ul style={s.list}>
            {items.map((item) => (
              <li key={`${item.file}:${item.line}`}>
                <button type="button" style={s.item} onClick={() => onOpenInDiff(item.file, item.line)}>
                  <span style={s.bullet}>▸</span>
                  <span className="mono" style={s.ref}>
                    {item.file}:{item.line}
                  </span>
                  <span style={s.reason}>— {item.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
