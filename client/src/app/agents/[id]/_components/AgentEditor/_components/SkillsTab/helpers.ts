/** Swap the element at `index` with its neighbor in `direction`, returning a
 *  new array. Out-of-range moves are a no-op (the caller disables the button
 *  at the edges, but this stays safe either way). */
export function moveId(ids: string[], index: number, direction: "up" | "down"): string[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
