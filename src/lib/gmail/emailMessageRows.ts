/**
 * The ONE builder of `email_message` / `email_message_person` insert rows.
 * Both writers use it — the Gmail sync (`writeSyncedMessages`) and the send
 * path (`storeSentEmailMessage`) — so a row written at send time cannot drift
 * from the row the sync would have written for the same message. Pure: no
 * I/O, never mutates its inputs.
 */
import type { NewEmailMessage, NewEmailMessagePerson } from "@/db/schema";
import type { ClassifiedMessage, ClassifiedMatch } from "./classify";

/** Caller must have checked `shouldStoreClassifiedMessage` — the first match becomes the convenience `person_id`. */
export function buildEmailMessageRow(bdId: string, c: ClassifiedMessage): NewEmailMessage {
  const primary = c.matches[0]!;
  return {
    bdId,
    gmailMessageId: c.gmailMessageId,
    gmailThreadId: c.gmailThreadId,
    direction: c.direction,
    personId: primary.personId,
    fromAddress: c.fromAddress,
    toAddresses: c.toAddresses,
    ccAddresses: c.ccAddresses,
    subject: c.subject,
    bodyText: c.bodyText,
    bodyTruncated: c.bodyTruncated,
    sentAt: c.sentAt,
    rfcMessageId: c.rfcMessageId,
    rfcReferences: c.references,
    matchedEmail: primary.matchedEmail,
    matchConfidence: primary.matchConfidence,
  };
}

/** One `email_message_person` row per match — the table the admin conversation view inner-joins. */
export function buildEmailMessagePersonRows(
  emailMessageId: string,
  matches: readonly ClassifiedMatch[],
): NewEmailMessagePerson[] {
  return matches.map((m) => ({
    emailMessageId,
    personId: m.personId,
    matchedEmail: m.matchedEmail,
    matchConfidence: m.matchConfidence,
  }));
}
