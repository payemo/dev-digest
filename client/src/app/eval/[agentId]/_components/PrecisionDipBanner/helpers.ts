/** How a metric moved, as an i18n key under `eval.detail` + whole points. */
export function movement(delta: number | null): { key: string; points: number } {
  if (delta == null) return { key: "detail.notApplicable", points: 0 };
  const points = Math.round(Math.abs(delta) * 100);
  if (points === 0) return { key: "detail.unchanged", points: 0 };
  return { key: delta > 0 ? "detail.movedUp" : "detail.movedDown", points };
}
