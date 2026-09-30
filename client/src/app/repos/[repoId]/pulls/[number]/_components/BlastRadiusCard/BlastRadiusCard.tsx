/* BlastRadiusCard — what else in the repository this PR's diff can reach: for
   every symbol its changed files declare, who calls it and which HTTP endpoints
   or scheduled jobs depend on those callers. It costs no model call and reads
   no new table — the server answers from the index repo-intel built at clone
   time — so this card fetches on every visit and renders for a PR that has
   never been reviewed. An unindexed repo comes back `degraded` rather than
   failing, which is a state this card must SHOW, not hide. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, EmptyState, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBlastRadius } from "@/lib/hooks/reviews";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { BlastRadiusView } from "../BlastRadiusView";
import { DEGRADED_COLOR, REASON_LABEL_KEY, UNKNOWN_REASON_KEY } from "./constants";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null;
  repoId: string;
  /** "owner/repo", null until the repo has loaded — see BlastRadiusView. */
  repoFullName: string | null;
  headSha: string;
}

export function BlastRadiusCard({ prId, repoId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError } = usePrBlastRadius(prId);
  const resync = useResyncRepoIntel(repoId);

  const heading = <SectionLabel icon="Workflow">{t("heading")}</SectionLabel>;

  if (isLoading) {
    return (
      <Card>
        {heading}
        <div style={s.loading}>
          <Skeleton height={18} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="45%" height={14} />
        </div>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        {heading}
        <EmptyState icon="AlertTriangle" title={t("error")} />
      </Card>
    );
  }

  // `Badge` is vendored and accepts no `title`, so the tooltip goes on a wrapper.
  const degraded = data.degraded ? (
    <div style={s.degradedRow}>
      <span title={t("degraded.hint")}>
        <Badge icon="AlertTriangle" color={DEGRADED_COLOR}>
          {t("degraded.badge")} ·{" "}
          {t(REASON_LABEL_KEY[data.reason ?? ""] ?? UNKNOWN_REASON_KEY)}
        </Badge>
      </span>
      {/* Not EmptyState's CTA: that one hardcodes a "+" icon, which is wrong
          for a re-index action. */}
      <Button
        kind="tertiary"
        size="sm"
        icon="RefreshCw"
        loading={resync.isPending}
        onClick={() => resync.mutate()}
      >
        {resync.isPending ? t("degraded.resyncing") : t("degraded.resync")}
      </Button>
    </div>
  ) : null;

  if (data.changed_symbols.length === 0) {
    return (
      <Card>
        <SectionLabel icon="Workflow" right={degraded}>
          {t("heading")}
        </SectionLabel>
        <EmptyState icon="Workflow" title={t("empty")} body={t("emptyHint")} />
      </Card>
    );
  }

  return (
    <Card>
      <SectionLabel icon="Workflow" right={degraded}>
        {t("heading")}
      </SectionLabel>
      <BlastRadiusView data={data} repoFullName={repoFullName} headSha={headSha} />
    </Card>
  );
}
