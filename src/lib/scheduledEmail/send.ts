import { sendGmailMessage } from "@/lib/gmail/send";
import { GmailSendError } from "@/lib/gmail/errors";
import { composeEmailBody } from "@/lib/signature/compose";
import { planThreadReply } from "@/lib/gmail/replyThread";
import { getThreadReplySource } from "@/lib/gmail/threadMessages";
import { resolveSurvivor } from "@/lib/contacts/queries";
import type { ClaimedEmail } from "./queries";

/**
 * The one sender: the SAME `sendGmailMessage` the "Correo" action uses, so the email_sent activity, the stored message
 * and the status/last-contact effects are written by the normal path and only now. The signature is composed at send time.
 */
export async function sendScheduledEmail(row: ClaimedEmail): Promise<{ messageId: string }> {
  // A Contact merged since scheduling: the touch must land on the live survivor, not on the merged-away row.
  const survivor = await resolveSurvivor(row.personId);
  if (!survivor) throw new GmailSendError("send_failed", "person_unavailable", undefined, 400); // provably not sent
  const base = { bdId: row.bdId, personId: survivor.id, ...composeEmailBody(row.body, row.signatureHtml) };
  if (!row.replyThreadId) return sendGmailMessage({ ...base, to: row.toAddress, subject: row.subject });
  // A reply re-derives recipient, subject and threading headers from stored messages, like sendThreadReplyAction.
  const plan = planThreadReply(await getThreadReplySource(row.bdId, survivor.id, row.replyThreadId));
  // Provably not sent (status 400 keeps failureCode off "outcome_unknown").
  if (!plan.ok) throw new GmailSendError("send_failed", "reply_unavailable", undefined, 400);
  return sendGmailMessage({ ...base, to: plan.to, subject: plan.subject, reply: { threadId: plan.threadId, inReplyTo: plan.inReplyTo, references: plan.references } });
}
