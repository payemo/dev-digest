export type Ago =
  | { unit: "justNow" }
  | { unit: "minutes" | "hours" | "days"; n: number };

/** Compact relative time for the Last run column; null when there is none. */
export function relativeAgo(iso: string | null, now: number): Ago | null {
  if (!iso) return null;
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return { unit: "justNow" };
  if (mins < 60) return { unit: "minutes", n: mins };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { unit: "hours", n: hours };
  return { unit: "days", n: Math.floor(hours / 24) };
}
