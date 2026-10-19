/**
 * What a BD may attach to an email, and how a stored attachment is described. Pure: no I/O, no env. The client uses it
 * to refuse a file before uploading; the server re-runs it on every send (the client is never trusted).
 *
 * Owner decision: max 5 files, 6 MB per file, 10 MB in total (Gmail accepts 25 MB, and base64 adds a third). Only the
 * extensions below are accepted; everything else (executables, archives, html, svg...) is blocked.
 */
import type { MagicKind } from "./magic";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const OOXML = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

export interface AllowedAttachmentType {
  /** The Content-Type the message is sent with (derived from the extension, never from the client). */
  contentType: string;
  /** Declared types browsers are known to report for this extension. */
  declared: readonly string[];
  magic: MagicKind;
}

const ALLOWED: Record<string, AllowedAttachmentType> = {
  pdf: { contentType: "application/pdf", declared: ["application/pdf"], magic: "pdf" },
  docx: { contentType: OOXML.docx, declared: [OOXML.docx], magic: "zip" },
  xlsx: { contentType: OOXML.xlsx, declared: [OOXML.xlsx], magic: "zip" },
  pptx: { contentType: OOXML.pptx, declared: [OOXML.pptx], magic: "zip" },
  doc: { contentType: "application/msword", declared: ["application/msword"], magic: "ole" },
  xls: { contentType: "application/vnd.ms-excel", declared: ["application/vnd.ms-excel"], magic: "ole" },
  ppt: { contentType: "application/vnd.ms-powerpoint", declared: ["application/vnd.ms-powerpoint"], magic: "ole" },
  png: { contentType: "image/png", declared: ["image/png"], magic: "png" },
  jpg: { contentType: "image/jpeg", declared: ["image/jpeg", "image/pjpeg"], magic: "jpg" },
  jpeg: { contentType: "image/jpeg", declared: ["image/jpeg", "image/pjpeg"], magic: "jpg" },
  txt: { contentType: "text/plain", declared: ["text/plain"], magic: "text" },
  // Windows browsers report a .csv as an Excel type.
  csv: { contentType: "text/csv", declared: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"], magic: "text" },
};

export type AttachmentRefusal = "type_not_allowed" | "empty" | "too_large";
export type AttachmentSetRefusal = "too_many" | "total_too_large";

export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

export function allowedTypeFor(filename: string): AllowedAttachmentType | null {
  const ext = extensionOf(filename);
  return ext && Object.hasOwn(ALLOWED, ext) ? ALLOWED[ext]! : null;
}

export type AttachmentMetaCheck = { ok: true; type: AllowedAttachmentType } | { ok: false; reason: AttachmentRefusal };

/** Extension allowlist + declared type + size. An empty declared type is accepted: the extension and the sniff decide. */
export function checkAttachmentMeta(file: { filename: string; contentType: string; size: number }): AttachmentMetaCheck {
  const type = allowedTypeFor(file.filename);
  if (!type) return { ok: false, reason: "type_not_allowed" };
  const declared = file.contentType.split(";")[0]!.trim().toLowerCase();
  if (declared !== "" && !type.declared.includes(declared)) return { ok: false, reason: "type_not_allowed" };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, type };
}

export function checkAttachmentSet(files: readonly { size: number }[]): AttachmentSetRefusal | null {
  if (files.length > MAX_ATTACHMENTS) return "too_many";
  return files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES ? "total_too_large" : null;
}

const DISPLAY_MAX = 120;

/**
 * The name shown to people and sent in the message: no path parts, no control characters or characters that are
 * illegal in a file name. Non-ASCII letters stay (the MIME builder encodes them, RFC 2231).
 */
export function sanitizeDisplayFilename(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const clean = last
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[<>:"*?|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!clean) return "archivo";
  if (clean.length <= DISPLAY_MAX) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
  return clean.slice(0, DISPLAY_MAX - ext.length) + ext;
}

/** The last path segment in Storage: ASCII only (Storage rejects many other keys), extension kept. */
export function storageSafeName(name: string): string {
  const ascii = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const dot = ascii.lastIndexOf(".");
  const rawExt = dot > 0 ? ascii.slice(dot + 1) : "";
  const ext = /^[A-Za-z0-9]{1,5}$/.test(rawExt) ? `.${rawExt}` : "";
  const stem = (ext ? ascii.slice(0, dot) : ascii).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return `${/[A-Za-z0-9]/.test(stem) ? stem : "file"}${ext}`;
}

/** "2,6 MB", the way the mockup writes sizes. */
export function formatAttachmentSize(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** A whole-megabyte limit as the mockup writes it: "10 MB". */
export function formatAttachmentLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
