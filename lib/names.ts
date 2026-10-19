// The document's "main" name: shown at the top of the mapper, used as the
// report title and to name exported files.

export const DEFAULT_DOC_NAME = "Untitled mapping";

/** "Payments error normalisation" -> "payments-error-normalisation" (safe for file names). */
export function fileSlug(name: string | undefined, fallback = "object-mapping"): string {
  const slug = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

/** "2026-10-18" */
export function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
