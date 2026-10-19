/**
 * Server glue of the composed-email actions: the signed-in user's identity and Storage session wired into the pure
 * `prepareCompose`, and the post-send cleanup. No "use server" directive on purpose (it exports non-actions); the
 * server-action files import it.
 */
import { getCurrentAuthUserId } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { supabaseAttachmentStorage } from "@/lib/email/attachments/storage";
import { markAttachmentsRemoved } from "@/lib/email/attachments/queries";
import { resolveParaRecipients } from "@/lib/email/recipients/queries";
import { isSuppressed } from "@/lib/sequences/suppression";
import { listSuppressionRules } from "@/lib/sequences/suppressionQueries";
import { isPlainCompose, prepareAttachments, prepareCompose, type ComposeExtras, type PrepareResult } from "./prepare";

const hasFiles = (extras: ComposeExtras) => (extras.attachments?.length ?? 0) > 0;

/** `load` reads the files back from Storage with the caller's own session (what an immediate send needs). */
export async function prepareComposeForCurrentUser(personId: string, extras: ComposeExtras, load: boolean): Promise<PrepareResult> {
  const ownerAuthUid = await getCurrentAuthUserId();
  const storage = load && hasFiles(extras) ? supabaseAttachmentStorage(await createClient()) : null;
  return prepareCompose({ personId, extras, ownerAuthUid, resolvePara: resolveParaRecipients, storage, load });
}

/**
 * True when any of the OTHER "Para" contacts has opted out (email_suppression). The record's own contact keeps the behaviour a
 * one-to-one email always had; the extra recipients are new, chosen by the BD in a list, and one opted-out person must never be
 * emailed by adding them. One read, and only when there are extra recipients.
 */
export async function hasSuppressedOthers(prepared: { recipients: { email: string }[] }): Promise<boolean> {
  const others = prepared.recipients.slice(1);
  if (others.length === 0) return false;
  const rules = await listSuppressionRules();
  return others.some((r) => isSuppressed(r.email, rules));
}

/**
 * What "Programar…" and its reschedule store: the other Para contacts, Cc and files, validated like an immediate send.
 * `emptyAs` decides what an empty composer means: a NEW schedule has nothing to store (`undefined`), a reschedule must clear
 * what was there (an empty compose). Either way an empty composer costs no Auth call and no lookup.
 */
export async function scheduledComposeForCurrentUser(personId: string, extras: ComposeExtras | undefined, emptyAs: "nothing" | "clear") {
  if (isPlainCompose(extras)) {
    return { ok: true as const, compose: emptyAs === "clear" ? { recipientPersonIds: [], ccAddresses: [], attachments: [], ownerAuthUid: "" } : undefined };
  }
  const ownerAuthUid = await getCurrentAuthUserId(); // once: the same id prepares the files and owns them
  const storage = hasFiles(extras!) ? supabaseAttachmentStorage(await createClient()) : null;
  const prepared = await prepareCompose({ personId, extras: extras!, ownerAuthUid, resolvePara: resolveParaRecipients, storage, load: true });
  if (!prepared.ok) return prepared;
  if (await hasSuppressedOthers(prepared)) return { ok: false as const, reason: "recipient_suppressed" as const };
  return {
    ok: true as const,
    compose: { recipientPersonIds: prepared.otherPersonIds, ccAddresses: prepared.cc, attachments: prepared.validated, ownerAuthUid },
  };
}

/** Thread reply: recipients stay as the thread dictates, only the files are checked and read. */
export async function prepareReplyAttachmentsForCurrentUser(refs: readonly unknown[]) {
  // A plain reply (no files) is exactly what it always was: no Auth round trip.
  if (refs.length === 0) return { ok: true as const, validated: [], files: [] };
  const ownerAuthUid = await getCurrentAuthUserId();
  const storage = refs.length > 0 ? supabaseAttachmentStorage(await createClient()) : null;
  return prepareAttachments(refs, ownerAuthUid, storage, true);
}

/**
 * The CRM must not keep the files: delete the objects right after a successful send. Best effort and never throws, because
 * the email already went out; a failure leaves the row tracked and the sweeper deletes the object within a day.
 */
export async function removeSentAttachments(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const removed = await supabaseAttachmentStorage(await createClient()).remove([...paths]);
    if (removed) await markAttachmentsRemoved(paths);
    else console.error("[email-attachments] could not delete sent attachments; the sweeper will retry");
  } catch (error) {
    console.error("[email-attachments] cleanup after send failed; the sweeper will retry", error);
  }
}
