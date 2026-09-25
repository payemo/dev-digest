/* SmartDiffGroups — the Smart Diff (L04) role grouping for the Files changed
   tab: one collapsible header per role, each wrapping a flat <DiffViewer> over
   that role's files.

   Grouping lives HERE, route-local, and not in the shared diff-viewer: role is
   a Smart Diff product concept, its copy is prReview-scoped, and with the order
   toggle off DiffTab renders the same single flat viewer it always has.

   All five groups always render, including empty ones (reading "0 files") —
   the fixed five-group order is the feature, so hiding an empty group would
   make a PR with no markdown show four. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiffGroup, SmartDiffRole } from "@devdigest/shared";
import {
  DiffViewer,
  type DiffCommentApi,
  type DiffFindingApi,
} from "@/components/diff-viewer";
import {
  DEFAULT_COLLAPSED_ROLES,
  ROLE_DESC_KEY,
  ROLE_LABEL_KEY,
  ROLE_SWATCH,
} from "./constants";
import { filesWithFindings, joinGroups } from "./helpers";
import { s, chevronFor } from "./styles";

/** Seeded once: `docs` and `boilerplate` start collapsed, everything else open. */
function initialOpenState(groups: SmartDiffGroup[]): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const g of groups) {
    state[g.role] = !DEFAULT_COLLAPSED_ROLES.includes(
      g.role as (typeof DEFAULT_COLLAPSED_ROLES)[number],
    );
  }
  return state;
}

export function SmartDiffGroups({
  groups,
  files,
  commenting,
  findings,
  hasReview,
}: {
  groups: SmartDiffGroup[];
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
  /** False → the counters are replaced by "no review has been run yet". */
  hasReview: boolean;
}) {
  const t = useTranslations("prReview");
  // Keyed by role, so flipping the order toggle does not reset what the user
  // opened (this component is not unmounted while it is rendered).
  const [open, setOpen] = React.useState<Record<string, boolean>>(() =>
    initialOpenState(groups),
  );
  const joined = React.useMemo(() => joinGroups(groups, files), [groups, files]);
  const anchors = findings?.anchors;

  const toggle = (role: SmartDiffRole) => setOpen((o) => ({ ...o, [role]: !o[role] }));

  return (
    <div style={s.list}>
      {joined.map((group) => {
        const isOpen = open[group.role] ?? true;
        const withFindings = filesWithFindings(group.files, anchors ?? []);
        const label = t(ROLE_LABEL_KEY[group.role]);
        return (
          // A labelled <section> (role=region): the group header and a file
          // card header are both role=button + aria-expanded, so without this
          // the two tiers are indistinguishable to assistive tech and to a
          // query alike.
          <section key={group.role} aria-label={label} style={s.group}>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(group.role)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(group.role);
                }
              }}
              style={s.header}
            >
              <Icon.ChevronRight size={13} style={chevronFor(isOpen)} />
              <span aria-hidden style={s.swatch(ROLE_SWATCH[group.role])} />
              <span style={s.roleName}>{label}</span>
              <span style={s.roleDesc}>{t(ROLE_DESC_KEY[group.role])}</span>
              {!hasReview ? (
                <span style={s.noReview}>{t("smartDiff.noReviewYet")}</span>
              ) : (
                withFindings > 0 && (
                  <span style={s.findingCount}>
                    <span aria-hidden style={s.findingDot} />
                    {t("smartDiff.filesWithFindings", { count: withFindings })}
                  </span>
                )
              )}
              <span className="tnum" style={s.fileCount}>
                {t("smartDiff.filesCount", { count: group.files.length })}
              </span>
            </div>
            {isOpen && group.files.length > 0 && (
              <DiffViewer files={group.files} commenting={commenting} findings={findings} />
            )}
          </section>
        );
      })}
    </div>
  );
}
