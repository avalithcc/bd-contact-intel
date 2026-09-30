/**
 * On-demand full-body read for one synced Gmail thread (email-sync.html
 * screen 1's expanded thread card — task brief §1). Bodies are NEVER part
 * of the record page's initial render (PERFORMANCE.md: no added round trip
 * to a page every BD loads); this is the query behind the "expand a
 * thread" action instead, called at most once per thread per view.
 *
 * Privacy, enforced in the WHERE clause itself, not just in the caller:
 * `email_message.bd_id = bdId` scopes every row to the REQUESTING BD's own
 * mailbox (never another BD's, and never bypassed for an admin here — an
 * admin reads another BD's conversation only through the existing audited
 * `getConversationForAdmin` path). The `EXISTS` against
 * `email_message_person` additionally requires the thread to actually
 * belong to `personId` — without it, a BD who can see two different
 * contacts' threads could pass one contact's `gmailThreadId` while viewing
 * a different contact's record and still get bodies back (same BD's own
 * data either way, but this keeps the action's inputs meaningfully scoped
 * to the page that called it).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailMessage } from "@/db/schema";

export interface ThreadMessageBody {
  gmailMessageId: string;
  bodyText: string | null;
  bodyTruncated: boolean;
}

export async function getThreadMessageBodies(
  bdId: string,
  personId: string,
  gmailThreadId: string,
): Promise<ThreadMessageBody[]> {
  return db
    .select({
      gmailMessageId: emailMessage.gmailMessageId,
      bodyText: emailMessage.bodyText,
      bodyTruncated: emailMessage.bodyTruncated,
    })
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.bdId, bdId),
        eq(emailMessage.gmailThreadId, gmailThreadId),
        // Literal table-qualified SQL text, not `${emailMessage.id}`
        // interpolation — PERFORMANCE.md's documented Drizzle 0.36.4 gotcha:
        // `email_message` is already bare-interpolated once as this query's
        // own `.from()` target, so reusing its `id` column via `${}`
        // interpolation inside this NESTED correlated subquery would risk
        // Drizzle silently re-emitting an earlier unqualified rendering.
        sql`exists (
          select 1 from email_message_person
          where email_message_person.email_message_id = email_message.id
            and email_message_person.person_id = ${personId}::uuid
        )`,
      ),
    )
    .orderBy(emailMessage.sentAt);
}
