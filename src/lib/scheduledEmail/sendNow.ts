import { checkRecipient } from "./recipient";
import { getOwnScheduled, isGmailConnected, sendScheduledNow, type EditResult } from "./queries";

/**
 * "Enviar ahora" / "Enviar igual" with the same re-validation as an edit: the stored recipient must still be one of the
 * Contact's own addresses (it may have changed since scheduling), and the mailbox must be connected.
 */
export async function sendScheduledNowChecked(input: { id: string; bdId: string }): Promise<EditResult | { ok: false; reason: "gmail_not_connected" | "invalid_email" | "multiple_recipients" | "schedule_recipient_invalid" | "attachment_missing" }> {
  const own = await getOwnScheduled(input.id, input.bdId);
  if (!own) return { ok: false, reason: "not_found" };
  // A row scheduled with files whose files are already gone (a failed or outcome-unknown row that had in fact been sent, and
  // whose objects were deleted right after) must never go out again without them: refuse with a clear reason.
  if (own.heldFiles < own.attachmentCount) return { ok: false, reason: "attachment_missing" };
  const recipient = await checkRecipient(own.personId, own.toAddress);
  if (recipient !== "ok") return { ok: false, reason: recipient };
  if (!(await isGmailConnected(input.bdId))) return { ok: false, reason: "gmail_not_connected" };
  return sendScheduledNow(input);
}
