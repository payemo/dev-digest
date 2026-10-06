/* PrBriefCard — the PR Brief on the Overview: a verdict banner over the
   brief's summary, the Intent and Blast radius snapshot the brief was
   generated with, verified Risk areas, and a Review focus list that deep-links
   into the Files changed tab. Reading the stored brief is free; generating is
   one paid model call, so it only ever happens on an explicit click. All model
   text renders as plain text — never Markdown, never HTML. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, EmptyState, SectionLabel } from "@devdigest/ui";
import type { PrBriefRecord, ReviewRecord } from "@devdigest/shared";
import { usePrBrief, useGeneratePrBrief, usePrReviews } from "@/lib/hooks/reviews";
import { ApiError } from "@/lib/api";
import { VerdictBanner } from "../VerdictBanner";
import { BlastRadiusView } from "../BlastRadiusView";
import { BriefSkeleton } from "./_components/BriefSkeleton";
import { IntentBlock } from "./_components/IntentBlock";
import { RiskAreas } from "./_components/RiskAreas";
import { ReviewFocusList } from "./_components/ReviewFocusList";
import { INPUT_LABEL_KEY } from "./constants";
import { inputGaps, latestReviewSummary } from "./helpers";
import { s } from "./styles";

interface PrBriefCardProps {
  prId: string | null;
  repoFullName: string | null;
  headSha: string;
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function PrBriefCard({ prId, repoFullName, headSha, onOpenInDiff }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const brief = usePrBrief(prId);
  const generate = useGeneratePrBrief(prId);
  // Already fetched by the PR page, so this is a cache hit, not a request.
  const { data: reviews } = usePrReviews(prId);

  const heading = <SectionLabel icon="FileText">{t("section")}</SectionLabel>;
  const record = brief.data ?? null;
  const pending = generate.isPending;

  const errorRow = generate.isError ? (
    <div role="alert" style={s.errorRow}>
      <span>
        {generate.error instanceof ApiError && generate.error.status === 409
          ? t("conflict")
          : t("error.title")}
      </span>
      <Button
        kind="secondary"
        size="sm"
        icon="RefreshCw"
        style={s.errorAction}
        onClick={() => generate.mutate()}
      >
        {t("error.retry")}
      </Button>
    </div>
  ) : null;

  if (brief.isLoading || (!record && pending)) {
    return (
      <section style={s.wrap}>
        {heading}
        <BriefSkeleton label={pending ? t("generating") : t("section")} />
      </section>
    );
  }

  if (!record) {
    return (
      <section style={s.wrap}>
        {heading}
        {errorRow}
        <Card>
          <EmptyState
            icon="FileText"
            title={t("empty.title")}
            body={
              <>
                {t("empty.hint")}
                <div style={s.emptyCta}>
                  <Button kind="primary" icon="FileText" onClick={() => generate.mutate()}>
                    {t("generate")}
                  </Button>
                </div>
              </>
            }
          />
        </Card>
      </section>
    );
  }

  return (
    <section style={s.wrap}>
      {heading}
      {errorRow}
      <BriefBody
        record={record}
        reviews={reviews}
        pending={pending}
        onRegenerate={() => generate.mutate()}
        repoFullName={repoFullName}
        headSha={headSha}
        onOpenInDiff={onOpenInDiff}
      />
    </section>
  );
}

interface BriefBodyProps {
  record: PrBriefRecord;
  reviews: ReviewRecord[] | undefined;
  pending: boolean;
  onRegenerate: () => void;
  repoFullName: string | null;
  headSha: string;
  onOpenInDiff: (file: string, line: number | null) => void;
}

/** The generated brief. Split out so the state machine above stays readable. */
function BriefBody({
  record,
  reviews,
  pending,
  onRegenerate,
  repoFullName,
  headSha,
  onOpenInDiff,
}: BriefBodyProps) {
  const t = useTranslations("brief");
  const review = latestReviewSummary(reviews);
  const gaps = inputGaps(record.inputs);
  const label = (keys: (keyof PrBriefRecord["inputs"])[]) =>
    keys.map((k) => t(INPUT_LABEL_KEY[k])).join(", ");

  const actions = (
    <>
      {record.is_stale && (
        // `Badge` is vendored and takes no `title`, so the tooltip goes on a wrapper.
        <span title={t("staleHint")}>
          <Badge icon="AlertTriangle" color="var(--warn)">
            {t("stale")}
          </Badge>
        </span>
      )}
      <Button
        kind="tertiary"
        size="sm"
        icon="RefreshCw"
        loading={pending}
        aria-label={pending ? t("generating") : t("regenerate")}
        title={t("regenerate")}
        onClick={onRegenerate}
      />
    </>
  );

  return (
    <>
      <VerdictBanner
        verdict={review?.verdict ?? null}
        summary={record.summary}
        score={review?.score ?? null}
        findingsCount={review?.findingsCount}
        blockers={review?.blockers}
        costUsd={record.cost_usd}
        tokensIn={record.tokens_in}
        tokensOut={record.tokens_out}
        actions={actions}
      />

      {(gaps.missing.length > 0 || gaps.partial.length > 0) && (
        <div style={s.inputsLine}>
          {gaps.missing.length > 0 && (
            <span>{t("missingInputs", { inputs: label(gaps.missing) })}</span>
          )}
          {gaps.partial.length > 0 && (
            <span>{t("partialInputs", { inputs: label(gaps.partial) })}</span>
          )}
        </div>
      )}

      <div style={s.grid}>
        <Card style={s.cell}>
          <div style={s.panel}>
            {record.intent && (
              <>
                <IntentBlock intent={record.intent} />
                <div style={s.divider} />
              </>
            )}
            <RiskAreas risks={record.risks.risks} onOpenInDiff={onOpenInDiff} />
          </div>
        </Card>
        {record.blast && (
          <Card pad={false} style={s.blastCard}>
            <div style={s.blastScroll}>
              <SectionLabel icon="Workflow">{t("block.blast")}</SectionLabel>
              <BlastRadiusView data={record.blast} repoFullName={repoFullName} headSha={headSha} />
            </div>
          </Card>
        )}
      </div>

      <ReviewFocusList items={record.review_focus} onOpenInDiff={onOpenInDiff} />
    </>
  );
}
