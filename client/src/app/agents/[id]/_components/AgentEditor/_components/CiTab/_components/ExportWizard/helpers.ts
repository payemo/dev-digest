import { strToU8, zipSync } from "fflate";
import type { CiFile, CiTrigger } from "@devdigest/shared";
import { TRIGGERS } from "./constants";

/** Zip the generated files (paths kept repo-relative). */
export function buildZip(files: Pick<CiFile, "path" | "contents">[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.path] = strToU8(f.contents);
  return zipSync(entries, { level: 6 });
}

/** Hand `data` to the browser as a file download. */
export function downloadBytes(data: Uint8Array, fileName: string): void {
  const blob = new Blob([data as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `devdigest-ci-<slug>.zip`, slug taken from the exported manifest path. */
export function zipFileName(files: Pick<CiFile, "path" | "role">[]): string {
  const manifest = files.find((f) => f.role === "manifest");
  const slug = manifest?.path.split("/").pop()?.replace(/\.ya?ml$/, "") ?? "agent";
  return `devdigest-ci-${slug}.zip`;
}

/** Toggle a trigger, keeping the canonical order. */
export function toggleTrigger(current: readonly CiTrigger[], t: CiTrigger): CiTrigger[] {
  const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
  return TRIGGERS.filter((x) => next.includes(x));
}

/** "1.5 MB" / "12 KB" / "300 B". */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** The blocking reasons a 409 from export carries, if any. */
export function blockingFromError(details: unknown): { code: string; message: string }[] {
  const b = (details as { blocking?: unknown } | null)?.blocking;
  return Array.isArray(b)
    ? b.filter((x): x is { code: string; message: string } => typeof x?.message === "string")
    : [];
}
