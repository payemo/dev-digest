/* BriefSkeleton — the brief's layout in placeholder bars, shown while the
   stored brief loads or while a first brief is being generated. */
"use client";

import React from "react";
import { Card, Skeleton } from "@devdigest/ui";
import { s } from "./styles";

export function BriefSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" style={s.wrap}>
      <Card>
        <div style={s.column}>
          <Skeleton width="40%" height={20} />
          <Skeleton height={14} />
          <Skeleton width="80%" height={14} />
        </div>
      </Card>
      <div style={s.grid}>
        <Card>
          <div style={s.column}>
            <Skeleton width="30%" height={12} />
            <Skeleton height={16} />
            <Skeleton width="60%" height={14} />
          </div>
        </Card>
        <Card>
          <div style={s.column}>
            <Skeleton width="30%" height={12} />
            <Skeleton height={14} />
            <Skeleton width="70%" height={14} />
          </div>
        </Card>
      </div>
      <Card>
        <div style={s.column}>
          <Skeleton width="35%" height={12} />
          <Skeleton width="75%" height={14} />
          <Skeleton width="65%" height={14} />
        </div>
      </Card>
    </div>
  );
}
