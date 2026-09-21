/* /skills/:id — Skill Editor. Thin route; see SkillsWorkbench. */
"use client";

import { useParams } from "next/navigation";
import { SkillsWorkbench } from "../_components/SkillsWorkbench";

export default function SkillDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <SkillsWorkbench skillId={id} />;
}
