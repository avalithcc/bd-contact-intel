import type { MimeAttachment } from "@/lib/gmail/mimeAttachments";
import { matchesMagic } from "./magic";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  checkAttachmentMeta,
  checkAttachmentSet,
  sanitizeDisplayFilename,
  type AllowedAttachmentType,
} from "./policy";
import type { AttachmentStorage } from "./storage";
import { pathBelongsTo } from "./storagePath";

/**
 * What a server action receives for each attached file: only where it is and what the client says it is. The bytes never
 * travel with it. Nothing here is trusted: the path must sit in the caller's folder, the type must be allowed, and at send
 * time the real object is read back and sniffed.
 */
export interface AttachmentRef {
  storagePath: string;
  filename: string;
  contentType: string;
  size: number;
}

export type AttachmentFailure =
  | "attachment_invalid"
  | "attachment_type_not_allowed"
  | "attachment_too_large"
  | "attachment_too_many"
  | "attachment_total_too_large"
  | "attachment_missing";

export interface ValidatedAttachment {
  storagePath: string;
  /** Sanitised display name (what the recipient sees and the timeline shows). */
  filename: string;
  /** Derived from the extension, never from the client. */
  contentType: string;
  type: AllowedAttachmentType;
  size: number;
}

export type ValidateResult = { ok: true; items: ValidatedAttachment[] } | { ok: false; reason: AttachmentFailure };

function isRef(value: unknown): value is AttachmentRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.storagePath === "string" && typeof v.filename === "string" && typeof v.contentType === "string" && typeof v.size === "number";
}

/** Pure checks on the descriptors, before any Storage access. `ownerAuthUid` is the uploader's auth user id. */
export function validateAttachmentRefs(refs: readonly unknown[], ownerAuthUid: string): ValidateResult {
  if (refs.length > MAX_ATTACHMENTS) return { ok: false, reason: "attachment_too_many" };
  const seen = new Set<string>();
  const items: ValidatedAttachment[] = [];
  for (const r of refs) {
    if (!isRef(r) || !pathBelongsTo(r.storagePath, ownerAuthUid) || seen.has(r.storagePath)) return { ok: false, reason: "attachment_invalid" };
    seen.add(r.storagePath);
    const filename = sanitizeDisplayFilename(r.filename);
    const meta = checkAttachmentMeta({ filename, contentType: r.contentType, size: r.size });
    if (!meta.ok) return { ok: false, reason: meta.reason === "type_not_allowed" ? "attachment_type_not_allowed" : meta.reason === "too_large" ? "attachment_too_large" : "attachment_invalid" };
    items.push({ storagePath: r.storagePath, filename, contentType: meta.type.contentType, type: meta.type, size: r.size });
  }
  const set = checkAttachmentSet(items);
  if (set) return { ok: false, reason: set === "too_many" ? "attachment_too_many" : "attachment_total_too_large" };
  return { ok: true, items };
}

export interface LoadedAttachment extends MimeAttachment {
  storagePath: string;
  /** The real size read from Storage. */
  size: number;
}

export type LoadResult = { ok: true; files: LoadedAttachment[] } | { ok: false; reason: AttachmentFailure };

/**
 * Reads every object back and holds the REAL bytes to the policy: the declared size is only a hint, so a client that lies
 * about it gains nothing. Fails closed on the first problem; nothing is sent partially.
 */
export async function loadAttachments(items: readonly ValidatedAttachment[], storage: AttachmentStorage): Promise<LoadResult> {
  const files: LoadedAttachment[] = [];
  let total = 0;
  for (const item of items) {
    const bytes = await storage.download(item.storagePath);
    if (!bytes) return { ok: false, reason: "attachment_missing" };
    if (bytes.length === 0) return { ok: false, reason: "attachment_invalid" };
    if (bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "attachment_too_large" };
    if (!matchesMagic(item.type.magic, bytes)) return { ok: false, reason: "attachment_type_not_allowed" };
    total += bytes.length;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) return { ok: false, reason: "attachment_total_too_large" };
    files.push({ storagePath: item.storagePath, filename: item.filename, contentType: item.contentType, data: bytes, size: bytes.length });
  }
  return { ok: true, files };
}
