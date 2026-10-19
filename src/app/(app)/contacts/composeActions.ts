"use server";

import { getCurrentAuthUserId, getCurrentBd } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { validateAttachmentRefs } from "@/lib/email/attachments/load";
import { isHeldByScheduledEmail, markAttachmentsRemoved, registerAttachments } from "@/lib/email/attachments/queries";
import { supabaseAttachmentStorage } from "@/lib/email/attachments/storage";
import { pathBelongsTo } from "@/lib/email/attachments/storagePath";
import { listParaCandidates, type ParaCandidate } from "@/lib/email/recipients/queries";
import { isUuid } from "@/lib/uuid";
import { actionFailure, type ContactActionResult } from "./actionErrors";

/**
 * Server actions behind the composer's attachments and recipient picker. Nothing here receives a file: the browser uploads
 * straight to the private bucket with the user's own session (Vercel caps request bodies at about 4.5 MB), and these only
 * hear about the resulting path.
 */

/**
 * Called by the composer right after an upload finishes. Re-checks the descriptor (path inside the caller's own folder,
 * allowed type, size) and records it, so a file nobody ends up sending is still known to the sweeper. On a refusal the
 * composer removes the object it just uploaded.
 */
export async function registerEmailAttachmentAction(ref: unknown): Promise<ContactActionResult> {
  try {
    const me = await getCurrentBd();
    const authUid = await getCurrentAuthUserId();
    const checked = validateAttachmentRefs([ref], authUid);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    await registerAttachments(me.id, authUid, checked.items);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

/** The composer dropped a file it uploaded (removed, replaced, dialog closed): delete the object now. */
export async function discardEmailAttachmentAction(storagePath: string): Promise<ContactActionResult> {
  try {
    await getCurrentBd();
    const authUid = await getCurrentAuthUserId();
    if (typeof storagePath !== "string" || !pathBelongsTo(storagePath, authUid)) return { ok: false, reason: "attachment_invalid" };
    // A file a scheduled email is holding goes away with that email (sent, or cancelled and swept), never from the composer.
    if (await isHeldByScheduledEmail(storagePath)) return { ok: false, reason: "attachment_invalid" };
    const removed = await supabaseAttachmentStorage(await createClient()).remove([storagePath]);
    if (removed) await markAttachmentsRemoved([storagePath]);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export type RecipientCandidatesResult = { ok: true; candidates: ParaCandidate[] } | { ok: false };

/** Contents of the "Añadir destinatario" picker: other live contacts of the record's company, one statement. */
export async function listRecipientCandidatesAction(personId: string): Promise<RecipientCandidatesResult> {
  try {
    if (!isUuid(personId)) return { ok: false };
    await getCurrentBd();
    return { ok: true, candidates: await listParaCandidates(personId) };
  } catch (err) {
    actionFailure(err);
    return { ok: false };
  }
}
