/* DiffTab — the Files changed tab. Owns the two controls above the diff (the
   Smart/Original order pair and the one visibility toggle shared by GitHub
   comments and review findings) and builds the generic findings slot the
   shared viewer renders through.

   The grouped view is strictly ADDITIVE: while `/smart-diff` is loading or has
   failed, this renders exactly the flat viewer it shipped with, so the tab
   never depends on the new endpoint. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Chip } from "@devdigest/ui";
import {
  DiffViewer,
  type DiffCommentApi,
  type DiffFindingAnchor,
  type DiffFindingApi,
} from "@/components/diff-viewer";
import {
  usePrComments,
  useCreatePrComment,
  useFindingAction,
  usePrReviews,
  useSmartDiff,
} from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { SmartDiffGroups } from "../SmartDiffGroups";
import { diffTotals } from "../SmartDiffGroups/helpers";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  repoFullName,
  headSha,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Already fetched by the PR page, so this is a cache hit, not a request.
  const { data: reviews } = usePrReviews(prId);
  const smartDiff = useSmartDiff(prId);
  const action = useFindingAction();
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const [grouped, setGrouped] = React.useState(true);

  const commentCount = comments?.length ?? 0;

  // Everything visual derives from the LATEST review's records (the list is
  // newest-first): the inline card needs the whole record anyway, and two
  // sources for "does this line have a finding" is a drift class.
  const latestFindings = React.useMemo(() => reviews?.[0]?.findings ?? [], [reviews]);
  const findingById = React.useMemo(
    () => new Map(latestFindings.map((f) => [f.id, f])),
    [latestFindings],
  );
  const anchors: DiffFindingAnchor[] = React.useMemo(
    () =>
      latestFindings.map((f) => ({
        id: f.id,
        path: f.file,
        line: f.start_line,
        severity: f.severity,
        label: t(`smartDiff.severityLabel.${f.severity}`),
      })),
    [latestFindings, t],
  );

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const findings: DiffFindingApi = {
    anchors,
    showFindings: showComments,
    unanchoredLabel: t("smartDiff.unanchored"),
    render: (id) => {
      const f = findingById.get(id);
      if (!f) return null;
      return (
        <FindingCard
          f={f}
          defaultExpanded
          pending={action.isPending}
          repoFullName={repoFullName}
          headSha={headSha}
          onAction={(act) =>
            action.mutate({ findingId: id, action: act, prId: prId ?? undefined })
          }
        />
      );
    },
  };

  const totals = diffTotals(files);
  const groupingFailed = smartDiff.isError;
  const canGroup = !!smartDiff.data && !groupingFailed;
  const showGrouped = grouped && canGroup;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={s.controls}>
            <div
              role="group"
              aria-label={t("smartDiff.orderControlLabel")}
              aria-disabled={!canGroup}
              style={canGroup ? s.orderGroup : s.orderGroupInert}
            >
              <Chip active={showGrouped} onClick={() => setGrouped(true)}>
                {t("smartDiff.smartOrder")}
              </Chip>
              <Chip active={!showGrouped} onClick={() => setGrouped(false)}>
                {t("smartDiff.originalOrder")}
              </Chip>
            </div>
            {(commentCount > 0 || anchors.length > 0) && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments
                  ? t("smartDiff.hideFindings", { count: commentCount + anchors.length })
                  : t("smartDiff.showFindings", { count: commentCount + anchors.length })}
              </Button>
            )}
          </div>
        }
      >
        {t("smartDiff.sectionTitle")}
      </SectionLabel>
      <div style={s.summary}>
        {t("smartDiff.summaryLine", {
          files: totals.files || filesCount,
          additions: totals.additions,
          deletions: totals.deletions,
        })}
      </div>
      {groupingFailed && <div style={s.degraded}>{t("smartDiff.groupingFailed")}</div>}
      {showGrouped ? (
        <SmartDiffGroups
          groups={smartDiff.data!.groups}
          files={files}
          commenting={commenting}
          findings={findings}
          hasReview={(reviews?.length ?? 0) > 0}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} findings={findings} />
      )}
    </section>
  );
}
