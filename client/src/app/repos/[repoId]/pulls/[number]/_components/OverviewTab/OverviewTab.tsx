"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { usePrBrief } from "@/lib/hooks/reviews";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefCard } from "../PrBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
  /** Deep-link into the Files changed tab (a brief focus item or risk ref). */
  onOpenInDiff: (file: string, line: number | null) => void;
}

export function OverviewTab({
  prId,
  prBody,
  repoId,
  repoFullName,
  headSha,
  onOpenInDiff,
}: OverviewTabProps) {
  // Same query PrBriefCard reads, so this is a cache hit. Once a brief exists
  // it carries the Intent and Blast snapshot itself; until then (loading, none,
  // or a failed read) the standalone cards keep rendering.
  const { data: brief } = usePrBrief(prId);
  const hasBrief = !!brief;

  return (
    <>
      <PrBriefCard
        prId={prId}
        repoFullName={repoFullName}
        headSha={headSha}
        onOpenInDiff={onOpenInDiff}
      />

      {!hasBrief && (
        <>
          {/* Derived intent sits ABOVE the author's own description: it answers
              "what is this for", which is what you want before reading the body. */}
          <IntentCard prId={prId} />

          {/* Blast radius is the same class of derived context, one question later:
              "what can it reach". So it follows intent and still precedes the prose. */}
          <BlastRadiusCard
            prId={prId}
            repoId={repoId}
            repoFullName={repoFullName}
            headSha={headSha}
          />
        </>
      )}

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
