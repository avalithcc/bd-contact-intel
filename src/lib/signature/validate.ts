import { sanitizeSignatureHtml, SIGNATURE_MAX_CHARS, SIGNATURE_MAX_OUTPUT_CHARS } from "@/lib/signature/sanitize";

export { SIGNATURE_MAX_CHARS, SIGNATURE_MAX_OUTPUT_CHARS };

export type SignatureSaveResult =
  | { ok: true; html: string | null }
  | { ok: false; error: "invalid" | "too_long" | "output_too_long" | "nothing_left" };

/**
 * Decides what a "save signature" request stores. Pure, so the rules are
 * unit-tested without a database. `html: null` means "clear".
 *
 * The size cap runs BEFORE parsing so a huge paste cannot cost CPU, and a
 * non-blank paste that sanitizes to nothing is an error rather than a silent
 * clear (the BD would believe a signature was saved).
 */
export function prepareSignatureForSave(raw: unknown): SignatureSaveResult {
  if (typeof raw !== "string") return { ok: false, error: "invalid" };
  if (raw.trim() === "") return { ok: true, html: null };
  if (raw.length > SIGNATURE_MAX_CHARS) return { ok: false, error: "too_long" };
  const html = sanitizeSignatureHtml(raw);
  if (html === "") return { ok: false, error: "nothing_left" };
  if (html.length > SIGNATURE_MAX_OUTPUT_CHARS) return { ok: false, error: "output_too_long" };
  return { ok: true, html };
}
