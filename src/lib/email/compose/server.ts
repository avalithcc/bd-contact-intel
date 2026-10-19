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
import { prepareAttachments, prepareCompose, type ComposeExtras, type PrepareResult } from "./prepare";

const hasFiles = (extras: ComposeExtras) => (extras.attachments?.length ?? 0) > 0;

/** `load` reads the files back from Storage with the caller's own session (what an immediate send needs). */
export async function prepareComposeForCurrentUser(personId: string, extras: ComposeExtras, load: boolean): Promise<PrepareResult> {
  const ownerAuthUid = await getCurrentAuthUserId();
  const storage = load && hasFiles(extras) ? supabaseAttachmentStorage(await createClient()) : null;
  return prepareCompose({ personId, extras, ownerAuthUid, resolvePara: resolveParaRecipients, storage, load });
}

/** Thread reply: recipients stay as the thread dictates, only the files are checked and read. */
export async function prepareReplyAttachmentsForCurrentUser(refs: readonly unknown[]) {
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
