import { checkCcList, type CcRefusal } from "@/lib/email/recipients/cc";
import type { ParaRecipient, ParaRefusal, ParaResult } from "@/lib/email/recipients/para";
import { isUuid } from "@/lib/uuid";
import {
  loadAttachments,
  validateAttachmentRefs,
  type AttachmentFailure,
  type LoadedAttachment,
  type ValidatedAttachment,
} from "@/lib/email/attachments/load";
import type { AttachmentStorage } from "@/lib/email/attachments/storage";

/**
 * Everything a composed email (send now, schedule, reschedule) takes besides subject and body. The client sends person ids
 * for "Para", plain strings for "Cc" and file descriptors for attachments; none of it is trusted. This module turns it into
 * what the sender needs, or the reason it was refused. The decisions (same company, internal Cc, file policy) live in their
 * own pure modules; this is only the order they run in. DB and Storage are injected so it is unit-tested with fakes.
 */
export interface ComposeExtras {
  /** The OTHER "Para" contacts (the record's own contact is always the first recipient and is not repeated here). */
  recipientPersonIds?: string[];
  ccAddresses?: string[];
  attachments?: unknown[];
}

export type PrepareFailure = ParaRefusal | CcRefusal | AttachmentFailure;

export interface PreparedCompose {
  /** The To header text: one address, or the Para addresses joined by comma. */
  to: string;
  /** Every Para contact, the record's own first. */
  recipients: ParaRecipient[];
  /** Everyone except the record's own contact. */
  otherPersonIds: string[];
  cc: string[];
  /** Descriptors for the scheduled row's bookkeeping. */
  validated: ValidatedAttachment[];
  /** The bytes, read back from Storage. Empty when `load` was off. */
  files: LoadedAttachment[];
}

export type PrepareResult = ({ ok: true } & PreparedCompose) | { ok: false; reason: PrepareFailure };

/** True when the extras ask for nothing beyond the classic single-recipient, text-only email. */
export function isPlainCompose(extras: ComposeExtras | undefined): boolean {
  return !extras || ((extras.recipientPersonIds?.length ?? 0) === 0 && (extras.ccAddresses?.length ?? 0) === 0 && (extras.attachments?.length ?? 0) === 0);
}

const MAX_IDS = 50; // a hostile list is refused before any lookup; the real cap (20 after dedupe) is MAX_PARA

export async function prepareCompose(input: {
  personId: string;
  extras: ComposeExtras;
  ownerAuthUid: string;
  resolvePara: (primaryId: string, otherIds: string[]) => Promise<ParaResult>;
  /** Needed (and read) only when there are attachments. */
  storage: AttachmentStorage | null;
  /** False skips reading the bytes (the descriptors are still checked). */
  load: boolean;
}): Promise<PrepareResult> {
  const { extras } = input;
  const others = extras.recipientPersonIds ?? [];
  if (!Array.isArray(others) || others.length > MAX_IDS || others.some((id) => typeof id !== "string" || !isUuid(id))) {
    return { ok: false, reason: "recipient_unavailable" };
  }
  const ccRaw = extras.ccAddresses ?? [];
  if (!Array.isArray(ccRaw) || ccRaw.some((a) => typeof a !== "string")) return { ok: false, reason: "cc_invalid" };
  const refs = extras.attachments ?? [];
  if (!Array.isArray(refs)) return { ok: false, reason: "attachment_invalid" };

  const para = await input.resolvePara(input.personId, others);
  if (!para.ok) return para;
  const cc = checkCcList(ccRaw, para.recipients.map((r) => r.email));
  if (!cc.ok) return cc;
  const attachments = await prepareAttachments(refs, input.ownerAuthUid, input.storage, input.load);
  if (!attachments.ok) return attachments;
  return {
    ok: true,
    to: para.to,
    recipients: para.recipients,
    otherPersonIds: para.recipients.slice(1).map((r) => r.personId),
    cc: cc.cc,
    validated: attachments.validated,
    files: attachments.files,
  };
}

/** The files alone (a thread reply keeps its recipients and takes only attachments). */
export async function prepareAttachments(
  refs: readonly unknown[],
  ownerAuthUid: string,
  storage: AttachmentStorage | null,
  load: boolean,
): Promise<{ ok: true; validated: ValidatedAttachment[]; files: LoadedAttachment[] } | { ok: false; reason: AttachmentFailure }> {
  const validated = validateAttachmentRefs(refs, ownerAuthUid);
  if (!validated.ok) return validated;
  if (!load || validated.items.length === 0) return { ok: true, validated: validated.items, files: [] };
  if (!storage) return { ok: false, reason: "attachment_missing" };
  const loaded = await loadAttachments(validated.items, storage);
  if (!loaded.ok) return loaded;
  return { ok: true, validated: validated.items, files: loaded.files };
}
