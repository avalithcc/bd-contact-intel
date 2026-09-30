/**
 * The viewing BD's OWN LinkedIn conversation with a Contact (owner decision
 * 2026-09-30: restore the right panel's "Historial de conversaciones" card
 * with an expandable full message history for the viewer's own connection,
 * loaded on demand — never during the record page's own render, same
 * "never a round trip on page load" rule as `getThreadMessageBodies`,
 * src/lib/gmail/threadMessages.ts). Unlike `getConversationForAdmin.ts`,
 * this is NOT an admin bypass and writes no audit row: a BD reading their
 * own conversation isn't reading anyone else's private data. Privacy is
 * enforced in the WHERE clause itself — `message.bd_id = bdId` scopes every
 * row to the REQUESTING BD's own imported messages, exactly the caller's
 * `getCurrentBd()` result, never a client-supplied id (see
 * ownConversationActions.ts).
 *
 * `person` joins on `conversation.peer_profile_key` (unique-indexed on
 * `person.profile_key`, see src/db/schema.ts) rather than looking the
 * profile key up in a separate round trip first — one query, no
 * intermediate lookup. A `null` peer_profile_key (group threads/InMail with
 * no resolvable profile, see src/lib/messagesCsv.ts) can never join to a
 * `person` row, so those are excluded here the same way
 * `recomputeMessageSignals` (src/lib/queries.ts) already excludes them from
 * per-contact aggregation.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversation, message, person } from "@/db/schema";
import { resolveMessageDirection, type MessageDirection } from "@/lib/activity/messageDirection";

export interface OwnConversationMessage {
  id: string;
  senderName: string | null;
  sentAt: Date;
  content: string;
  direction: MessageDirection;
}

export async function getOwnConversationMessages(bdId: string, personId: string): Promise<OwnConversationMessage[]> {
  const rows = await db
    .select({
      id: message.id,
      senderName: message.senderName,
      senderProfileKey: message.senderProfileKey,
      sentAt: message.sentAt,
      content: message.content,
      peerProfileKey: conversation.peerProfileKey,
    })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .innerJoin(person, eq(person.profileKey, conversation.peerProfileKey))
    .where(and(eq(message.bdId, bdId), eq(person.id, personId), eq(message.isDraft, false)))
    .orderBy(asc(message.sentAt));

  return rows.map((r) => ({
    id: r.id,
    senderName: r.senderName,
    sentAt: r.sentAt,
    content: r.content,
    direction: resolveMessageDirection(r.senderProfileKey, r.peerProfileKey),
  }));
}
