import { buildAttachmentPath, pathBelongsTo } from "@/lib/email/attachments/storagePath";
import { extensionOf, storageSafeName } from "@/lib/email/attachments/policy";

/**
 * What may be uploaded as a tender's pliego, and where it lives. Pure and client-safe: the browser refuses a file before
 * uploading with it, and the server re-runs it on every registration (the client is never trusted). Same discipline as the
 * email attachments (extension + declared type + size here, content sniff at analysis time), with one bucket of its own.
 *
 * PDF only: the analysis reads the PDF itself, and a pliego that arrives as .doc or .zip would upload fine and then sit
 * there unreadable. Pliegos run past the email limit, hence 20 MB (the model reads PDFs up to 32 MB).
 */
export const TENDER_DOCUMENTS_BUCKET = "tender-documents";
export const MAX_TENDER_DOCUMENT_BYTES = 20 * 1024 * 1024;

export type TenderDocumentRefusal = "type_not_allowed" | "empty" | "too_large";

export function checkTenderDocument(file: { filename: string; contentType: string; size: number }): { ok: true } | { ok: false; reason: TenderDocumentRefusal } {
  if (extensionOf(file.filename) !== "pdf") return { ok: false, reason: "type_not_allowed" };
  const declared = file.contentType.split(";")[0]!.trim().toLowerCase();
  if (declared !== "" && declared !== "application/pdf") return { ok: false, reason: "type_not_allowed" };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_TENDER_DOCUMENT_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true };
}

/** `<auth uid>/<uuid>/<ascii name>`: the first folder is what the bucket's RLS keys on. */
export function tenderDocumentPath(authUid: string, uploadId: string, filename: string): string {
  return buildAttachmentPath(authUid, uploadId, storageSafeName(filename));
}

/** True only for a well-formed path inside the caller's own folder. */
export const tenderDocumentPathBelongsTo = pathBelongsTo;
