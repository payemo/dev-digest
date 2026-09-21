/* ConventionCard — one scanned candidate: rule, category, evidence, excerpt,
   confidence, and its persistent triage state. Accept/Reject/Edit are all
   PATCH /conventions/:id under the hood; Edit is fully inline (no navigation,
   no second modal), matching the acceptance criteria. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ConventionCandidate, ConventionCategory } from "@devdigest/shared";
import { Button, Card, MonoLink, PercentProgress, Badge, SelectInput, TextInput } from "@devdigest/ui";
import { useUpdateConvention } from "@/lib/hooks/conventions";
import { CATEGORY_ORDER } from "./constants";
import { confidencePercent, evidenceGithubUrl, evidenceLabel } from "../../helpers";
import { s } from "./styles";

export function ConventionCard({
  repoId,
  repoFullName,
  defaultBranch,
  candidate,
}: {
  repoId: string;
  repoFullName: string;
  defaultBranch: string;
  candidate: ConventionCandidate;
}) {
  const t = useTranslations("conventions");
  const update = useUpdateConvention();
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [category, setCategory] = React.useState<ConventionCategory>(candidate.category);

  const startEdit = () => {
    setRule(candidate.rule);
    setCategory(candidate.category);
    setEditing(true);
  };

  const save = () => {
    update.mutate(
      { repoId, id: candidate.id, patch: { rule: rule.trim(), category } },
      { onSuccess: () => setEditing(false) },
    );
  };

  // Accept/Reject are toggles: clicking the already-active one reverts to pending.
  const setStatus = (status: "approved" | "rejected") => {
    const next = candidate.status === status ? "pending" : status;
    update.mutate({ repoId, id: candidate.id, patch: { status: next } });
  };

  const evidenceUrl = evidenceGithubUrl(repoFullName, defaultBranch, candidate);
  const evidence = evidenceLabel(candidate);

  return (
    <Card>
      <div style={s.card}>
        <div style={s.row}>
          <div style={s.body}>
            {editing ? (
              <div style={s.editRow}>
                <TextInput value={rule} onChange={setRule} placeholder={t("card.editRulePlaceholder")} />
                <SelectInput
                  value={category}
                  onChange={(v) => setCategory(v as ConventionCategory)}
                  options={CATEGORY_ORDER.map((c) => ({ value: c, label: t(`card.category.${c}`) }))}
                />
              </div>
            ) : (
              <div style={s.ruleRow}>
                <span style={s.rule}>{candidate.rule}</span>
                <Badge>{t(`card.category.${candidate.category}`)}</Badge>
                {candidate.status === "approved" && (
                  <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
                    {t("card.accepted")}
                  </Badge>
                )}
                {candidate.status === "rejected" && (
                  <Badge color="var(--text-muted)" icon="X">
                    {t("card.rejected")}
                  </Badge>
                )}
              </div>
            )}

            {evidence && (
              <div style={s.evidenceRow}>
                {evidenceUrl ? (
                  <MonoLink href={evidenceUrl}>{evidence}</MonoLink>
                ) : (
                  <span className="mono" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {evidence}
                  </span>
                )}
              </div>
            )}

            {candidate.evidence_snippet && <pre style={s.excerpt}>{candidate.evidence_snippet}</pre>}

            {candidate.confidence != null && (
              <div style={s.confidenceRow}>
                <PercentProgress label={t("card.confidence")} value={confidencePercent(candidate.confidence)} />
              </div>
            )}
          </div>

          <div style={s.actions}>
            {editing ? (
              <div style={s.editActions}>
                <Button kind="primary" icon="Check" onClick={save} disabled={!rule.trim() || update.isPending}>
                  {t("card.save")}
                </Button>
                <Button kind="ghost" onClick={() => setEditing(false)} disabled={update.isPending}>
                  {t("card.cancel")}
                </Button>
              </div>
            ) : (
              <>
                <Button
                  kind={candidate.status === "approved" ? "primary" : "secondary"}
                  icon="Check"
                  onClick={() => setStatus("approved")}
                  disabled={update.isPending}
                  full
                >
                  {t("card.accept")}
                </Button>
                <Button
                  kind={candidate.status === "rejected" ? "danger" : "ghost"}
                  icon="X"
                  onClick={() => setStatus("rejected")}
                  disabled={update.isPending}
                  full
                >
                  {t("card.reject")}
                </Button>
                <Button kind="ghost" icon="Edit" onClick={startEdit} disabled={update.isPending} full>
                  {t("card.edit")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
