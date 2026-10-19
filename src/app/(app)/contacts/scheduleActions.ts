"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { getCurrentAuthUserId, getCurrentBd } from "@/lib/queries";
import { isPlainCompose, type ComposeExtras } from "@/lib/email/compose/prepare";
import { prepareComposeForCurrentUser } from "@/lib/email/compose/server";
import { serviceRoleConfigured } from "@/lib/supabase/serviceRole";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { validateNewEmailInput } from "@/lib/contacts/newEmailInput";
import { cancelScheduled, editScheduled, getOwnScheduled, scheduleEmail } from "@/lib/scheduledEmail/queries";
import { sendScheduledNowChecked } from "@/lib/scheduledEmail/sendNow";
import { checkRecipient } from "@/lib/scheduledEmail/recipient";
import { isUuid } from "@/lib/uuid";
import { actionFailure, type ContactActionResult } from "./actionErrors";

/**
 * Server actions behind "Programar envío". Ownership is enforced in the queries (`bd_id = session BD`), the limits and the
 * 2-minute lock in the planner/SQL; the client only proposes a time. The typed reasons mirror sendContactEmailAction.
 */
export async function scheduleContactEmailAction(
  personId: string,
  to: string,
  subject: string,
  body: string,
  sendAtIso: string,
  extras?: ComposeExtras,
): Promise<ContactActionResult> {
  try {
    if (!isUuid(personId)) return { ok: false, reason: "not_found" };
    const input = validateNewEmailInput(subject, body);
    if (!input.ok) return { ok: false, reason: input.reason };
    // Files are read back by the cron with the service role. Without the key the email would fail at its time, so it is
    // refused here, up front, with a clear message.
    if (hasAttachments(extras) && !serviceRoleConfigured()) return { ok: false, reason: "attachments_unavailable" };
    await assertContactEditableById(personId);
    const recipient = await checkRecipient(personId, to);
    if (recipient !== "ok") return { ok: false, reason: recipient };
    const me = await getCurrentBd();
    const [account] = await db.select({ status: emailAccount.status }).from(emailAccount).where(eq(emailAccount.bdId, me.id));
    if (account?.status !== "connected") return { ok: false, reason: "gmail_not_connected" };
    const compose = await scheduledCompose(personId, extras);
    if (!compose.ok) return { ok: false, reason: compose.reason };
    const result = await scheduleEmail({ bdId: me.id, personId, toAddress: to, subject: input.subject, body: input.body, sendAt: new Date(sendAtIso), compose: compose.compose });
    if (!result.ok) return result;
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

const hasAttachments = (extras: ComposeExtras | undefined) => (extras?.attachments?.length ?? 0) > 0;

/**
 * "Para", "Cc" and files of a scheduled email, validated like an immediate send (same-company rule, internal Cc, file
 * policy and the real bytes) so a bad file is refused now instead of at the send time. `undefined` for a plain email.
 */
async function scheduledCompose(personId: string, extras: ComposeExtras | undefined) {
  if (isPlainCompose(extras)) return { ok: true as const, compose: undefined };
  const prepared = await prepareComposeForCurrentUser(personId, extras!, true);
  if (!prepared.ok) return prepared;
  return {
    ok: true as const,
    compose: { recipientPersonIds: prepared.otherPersonIds, ccAddresses: prepared.cc, attachments: prepared.validated, ownerAuthUid: await getCurrentAuthUserId() },
  };
}

export async function editScheduledEmailAction(id: string, subject: string, body: string, sendAtIso: string, extras?: ComposeExtras): Promise<ContactActionResult> {
  try {
    if (!isUuid(id)) return { ok: false, reason: "not_found" };
    const input = validateNewEmailInput(subject, body);
    if (!input.ok) return { ok: false, reason: input.reason };
    if (hasAttachments(extras) && !serviceRoleConfigured()) return { ok: false, reason: "attachments_unavailable" };
    const me = await getCurrentBd();
    // The stored recipient is re-checked: the Contact's address may have changed since it was scheduled.
    const own = await getOwnScheduled(id, me.id);
    if (!own) return { ok: false, reason: "not_found" };
    const recipient = await checkRecipient(own.personId, own.toAddress);
    if (recipient !== "ok") return { ok: false, reason: recipient };
    // `extras` given (the composer always sends it) replaces the recipients, Cc and files, even with everything removed;
    // left out, they stay as scheduled.
    let compose;
    if (extras) {
      const prepared = await prepareComposeForCurrentUser(own.personId, extras, true);
      if (!prepared.ok) return { ok: false, reason: prepared.reason };
      compose = { recipientPersonIds: prepared.otherPersonIds, ccAddresses: prepared.cc, attachments: prepared.validated, ownerAuthUid: await getCurrentAuthUserId() };
    }
    return await editScheduled({ id, bdId: me.id, subject: input.subject, body: input.body, sendAt: new Date(sendAtIso), compose });
  } catch (err) {
    return actionFailure(err);
  }
}

export async function cancelScheduledEmailAction(id: string): Promise<ContactActionResult> {
  try {
    if (!isUuid(id)) return { ok: false, reason: "not_found" };
    const me = await getCurrentBd();
    return await cancelScheduled({ id, bdId: me.id });
  } catch (err) {
    return actionFailure(err);
  }
}

/** "Enviar ahora" / "Enviar igual": the row goes out within the next minute. Needs a connected mailbox, like scheduling. */
export async function sendScheduledNowAction(id: string): Promise<ContactActionResult> {
  try {
    if (!isUuid(id)) return { ok: false, reason: "not_found" };
    const me = await getCurrentBd();
    return await sendScheduledNowChecked({ id, bdId: me.id });
  } catch (err) {
    return actionFailure(err);
  }
}
