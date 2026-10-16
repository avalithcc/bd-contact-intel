"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { getCurrentBd } from "@/lib/queries";
import { assertContactEditableById } from "@/lib/contacts/queries";
import { validateNewEmailInput } from "@/lib/contacts/newEmailInput";
import { cancelScheduled, editScheduled, getOwnScheduled, scheduleEmail } from "@/lib/scheduledEmail/queries";
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
): Promise<ContactActionResult> {
  try {
    if (!isUuid(personId)) return { ok: false, reason: "not_found" };
    const input = validateNewEmailInput(subject, body);
    if (!input.ok) return { ok: false, reason: input.reason };
    await assertContactEditableById(personId);
    const recipient = await checkRecipient(personId, to);
    if (recipient !== "ok") return { ok: false, reason: recipient };
    const me = await getCurrentBd();
    const [account] = await db.select({ status: emailAccount.status }).from(emailAccount).where(eq(emailAccount.bdId, me.id));
    if (account?.status !== "connected") return { ok: false, reason: "gmail_not_connected" };
    const result = await scheduleEmail({ bdId: me.id, personId, toAddress: to, subject: input.subject, body: input.body, sendAt: new Date(sendAtIso) });
    if (!result.ok) return result;
    revalidatePath(`/contacts/${personId}`);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function editScheduledEmailAction(id: string, subject: string, body: string, sendAtIso: string): Promise<ContactActionResult> {
  try {
    if (!isUuid(id)) return { ok: false, reason: "not_found" };
    const input = validateNewEmailInput(subject, body);
    if (!input.ok) return { ok: false, reason: input.reason };
    const me = await getCurrentBd();
    // The stored recipient is re-checked: the Contact's address may have changed since it was scheduled.
    const own = await getOwnScheduled(id, me.id);
    if (!own) return { ok: false, reason: "not_found" };
    const recipient = await checkRecipient(own.personId, own.toAddress);
    if (recipient !== "ok") return { ok: false, reason: recipient };
    return await editScheduled({ id, bdId: me.id, subject: input.subject, body: input.body, sendAt: new Date(sendAtIso) });
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
