/* IntentCard — the PR's derived intent: one sentence of motivation, what the
   change is and is not in scope for, the risk areas whose evidence survived
   code verification, and the confidence that was COMPUTED from the evidence
   (never reported by the model). Deriving is explicit and costs a model call,
   so this card never derives on its own — it renders what a review run (or the
   user's own button) already produced. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, ConfidenceNum, EmptyState, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrIntent, useDerivePrIntent } from "@/lib/hooks/reviews";
import { BAND_COLOR, IN_SCOPE_ICON, OUT_OF_SCOPE_ICON, RISK_ICON } from "./constants";
import { bandOf, formatCost, sourceKinds, tokenTotal } from "./helpers";
import { s } from "./styles";

interface ScopeListProps {
  title: string;
  icon: typeof IN_SCOPE_ICON | typeof OUT_OF_SCOPE_ICON;
  items: string[];
}

function ScopeList({ title, icon, items }: ScopeListProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <div style={s.scopeHeading}>
        <Badge icon={icon}>{title}</Badge>
      </div>
      <ul style={s.scopeList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("prReview.intent");
  const { data: intent, isLoading } = usePrIntent(prId);
  const derive = useDerivePrIntent(prId);

  if (isLoading) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("heading")}</SectionLabel>
        <div style={s.loading}>
          <Skeleton height={18} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="45%" height={14} />
        </div>
      </Card>
    );
  }

  if (!intent) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("heading")}</SectionLabel>
        <EmptyState
          icon="Target"
          title={t("empty")}
          body={t("emptyHint")}
          cta={derive.isPending ? t("deriving") : t("derive")}
          ctaLoading={derive.isPending}
          onCta={() => derive.mutate()}
        />
      </Card>
    );
  }

  const band = bandOf(intent.confidence);
  const tokens = tokenTotal(intent.tokens_in, intent.tokens_out);

  return (
    <Card>
      <SectionLabel
        icon="Target"
        right={
          intent.is_stale ? (
            // A <span> Badge, not a Chip: this is a state, not a control. The
            // tooltip goes on a wrapper — `Badge` is vendored and takes no
            // `title`, and rebuilding a vendored primitive is not allowed.
            <span title={t("staleHint")}>
              <Badge icon="AlertTriangle" color="var(--warn)">
                {t("stale")}
              </Badge>
            </span>
          ) : null
        }
      >
        {t("heading")}
      </SectionLabel>

      {/* Model output rendered as PLAIN TEXT, never Markdown: a derived
          sentence built from untrusted sources must not become markup. */}
      <p style={s.sentence}>“{intent.intent}”</p>

      <div style={s.scopeGrid}>
        <ScopeList title={t("inScope")} icon={IN_SCOPE_ICON} items={intent.in_scope} />
        <ScopeList title={t("outOfScope")} icon={OUT_OF_SCOPE_ICON} items={intent.out_of_scope} />
      </div>

      {intent.risk_areas.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={s.scopeHeading}>
            <Badge icon={RISK_ICON} color="var(--warn)">
              {t("riskAreas")}
            </Badge>
          </div>
          <div style={s.chipRow}>
            {intent.risk_areas.map((risk) => (
              // Badge (a <span>), NOT Chip (a <button>) — these are read-only
              // labels and must not be announced as interactive.
              <span
                key={`${risk.label}@${risk.evidence_path ?? ""}`}
                title={risk.evidence_path ?? undefined}
              >
                <Badge>{risk.label}</Badge>
              </span>
            ))}
          </div>
        </div>
      )}

      {band === "low" && <p style={s.hint}>{t("lowHint")}</p>}

      <div style={s.footer}>
        <ConfidenceNum value={intent.confidence} />
        <Badge color={BAND_COLOR[band]} dot>
          {t(`confidence.${band}`)}
        </Badge>
        {intent.sources.length > 0 && (
          <span>{t("basedOn", { sources: sourceKinds(intent.sources).join(", ") })}</span>
        )}
        <div style={s.footerRight}>
          {tokens != null && (
            <span className="mono">
              {t("usage", { tokens: String(tokens), cost: formatCost(intent.cost_usd) })}
            </span>
          )}
          <Button
            kind="tertiary"
            size="sm"
            icon="RefreshCw"
            loading={derive.isPending}
            onClick={() => derive.mutate()}
          >
            {derive.isPending ? t("deriving") : t("rederive")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
