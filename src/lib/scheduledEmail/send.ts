import { sendGmailMessage } from "@/lib/gmail/send";
import { GmailSendError } from "@/lib/gmail/errors";
import type { MessageContent } from "@/lib/gmail/rawMessage";
import { composeEmailBody } from "@/lib/signature/compose";
import { planThreadReply } from "@/lib/gmail/replyThread";
import { getThreadReplySource } from "@/lib/gmail/threadMessages";
import { resolveSurvivor } from "@/lib/contacts/queries";
import { loadAttachments, validateAttachmentRefs, type LoadedAttachment } from "@/lib/email/attachments/load";
import { markAttachmentsRemoved } from "@/lib/email/attachments/queries";
import type { AttachmentStorage } from "@/lib/email/attachments/storage";
import { checkCcList } from "@/lib/email/recipients/cc";
import type { ParaRecipient } from "@/lib/email/recipients/para";
import { resolveParaRecipients } from "@/lib/email/recipients/queries";
import { serviceRoleAttachmentStorage } from "@/lib/supabase/serviceRole";
import { ATTACHMENT_FAILED, ATTACHMENTS_UNAVAILABLE } from "./codes";
import type { ClaimedEmail } from "./queries";

const notSent = (code: string) => new GmailSendError("send_failed", code, undefined, 400); // status 400 keeps failureCode off "outcome_unknown"

/**
 * The files of a due row, read back with the service role (the cron has no user session). Fail closed: no key, a row that
 * does not belong to this BD, a missing object or one that no longer passes the policy all stop the send. An email that
 * was meant to carry a file is never sent without it.
 */
export async function loadRowAttachments(row: ClaimedEmail, storage: AttachmentStorage | null): Promise<LoadedAttachment[]> {
  if (row.attachments.length === 0) return [];
  if (!storage) throw notSent(ATTACHMENTS_UNAVAILABLE);
  const owners = new Set(row.attachments.map((a) => a.ownerAuthUid));
  if (owners.size !== 1 || row.attachments.some((a) => a.bdId !== row.bdId)) throw notSent(ATTACHMENT_FAILED);
  const checked = validateAttachmentRefs(
    row.attachments.map((a) => ({ storagePath: a.storagePath, filename: a.filename, contentType: a.contentType, size: a.sizeBytes })),
    [...owners][0]!,
  );
  if (!checked.ok) throw notSent(ATTACHMENT_FAILED);
  const loaded = await loadAttachments(checked.items, storage);
  if (!loaded.ok) throw notSent(ATTACHMENT_FAILED);
  return loaded.files;
}

/**
 * The one sender: the SAME `sendGmailMessage` the "Correo" action uses, so the email_sent activity, the stored message
 * and the status/last-contact effects are written by the normal path and only now. The signature is composed at send time.
 */
export async function sendScheduledEmail(row: ClaimedEmail): Promise<{ messageId: string }> {
  // A Contact merged since scheduling: the touch must land on the live survivor, not on the merged-away row.
  const survivor = await resolveSurvivor(row.personId);
  if (!survivor) throw new GmailSendError("send_failed", "person_unavailable", undefined, 400); // provably not sent
  const base = { bdId: row.bdId, personId: survivor.id, ...composeEmailBody(row.body, row.signatureHtml) };

  const storage = row.attachments.length ? serviceRoleAttachmentStorage() : null;
  const files = await loadRowAttachments(row, storage);
  const sent = await sendRow(row, survivor.id, base, files);
  if (storage && files.length) await dropSentFiles(storage, files);
  return sent;
}

async function sendRow(row: ClaimedEmail, survivorId: string, base: { bdId: string; personId: string } & MessageContent, files: LoadedAttachment[]) {
  const attachments = files.length ? files : undefined;
  if (!row.replyThreadId) {
    // Several "Para" contacts and Cc are re-validated now: the company rule, merges and the contacts' emails may have changed.
    let to = row.toAddress;
    let recipients: ParaRecipient[] | undefined;
    if (row.recipientPersonIds.length > 0) {
      const para = await resolveParaRecipients(survivorId, row.recipientPersonIds);
      if (!para.ok) throw new GmailSendError("invalid_recipient", `A recipient is no longer valid (${para.reason})`, "malformed");
      to = para.to;
      recipients = para.recipients.length > 1 ? para.recipients : undefined;
    }
    const paraEmails = (recipients ?? [{ email: row.toAddress }]).map((r) => r.email);
    const cc = checkCcList(row.ccAddresses, paraEmails);
    if (!cc.ok) throw new GmailSendError("invalid_recipient", `A Cc address is no longer valid (${cc.reason})`, "malformed");
    return sendGmailMessage({ ...base, to, subject: row.subject, allowRecipientList: Boolean(recipients), recipients, cc: cc.cc, attachments });
  }
  // A reply re-derives recipient, subject and threading headers from stored messages, like sendThreadReplyAction.
  const plan = planThreadReply(await getThreadReplySource(row.bdId, survivorId, row.replyThreadId));
  // Provably not sent (status 400 keeps failureCode off "outcome_unknown").
  if (!plan.ok) throw new GmailSendError("send_failed", "reply_unavailable", undefined, 400);
  return sendGmailMessage({ ...base, to: plan.to, subject: plan.subject, allowRecipientList: true, reply: { threadId: plan.threadId, inReplyTo: plan.inReplyTo, references: plan.references }, attachments });
}

/** The CRM must not keep the files: delete them as soon as the email is out. A failure leaves them to the sweeper. */
async function dropSentFiles(storage: AttachmentStorage, files: LoadedAttachment[]): Promise<void> {
  const paths = files.map((f) => f.storagePath);
  try {
    if (await storage.remove(paths)) await markAttachmentsRemoved(paths);
    else console.error("[scheduled-email] could not delete sent attachments; the sweeper will retry");
  } catch (error) {
    console.error("[scheduled-email] cleanup after send failed; the sweeper will retry", error);
  }
}
