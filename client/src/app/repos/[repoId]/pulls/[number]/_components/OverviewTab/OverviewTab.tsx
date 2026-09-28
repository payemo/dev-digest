"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
}

export function OverviewTab({ prId, prBody, repoId, repoFullName, headSha }: OverviewTabProps) {
  return (
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

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
