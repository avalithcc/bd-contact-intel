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
 * Bugfix (PR #235 review): used to join `conversation.peer_profile_key`
 * straight to `person.profile_key`. That column is single-valued and NOT
 * migrated by a merge (src/lib/identity/mergedProfileKeys.ts's doc comment),
 * so a merged contact's summary card showed a real message count (from the
 * migrated `person_bd_connection` row) while expanding it returned an empty
 * message list. Resolves every profile key that belongs to `personId` once
 * merges are taken into account (`mergedProfileKeysSql` — the survivor's own
 * key plus every merged-away person's, walking `merged_into_id`) instead of
 * joining `person` directly — still one query, no intermediate round trip. A
 * `null` peer_profile_key (group threads/InMail with no resolvable profile,
 * see src/lib/messagesCsv.ts) can never match the resolved key set, so those
 * are excluded here the same way `recomputeMessageSignals`
 * (src/lib/queries.ts) already excludes them from per-contact aggregation.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { conversation, message } from "@/db/schema";
import { resolveMessageDirection, type MessageDirection } from "@/lib/activity/messageDirection";
import { mergedProfileKeysSql } from "@/lib/identity/mergedProfileKeys";

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
    .where(
      and(
        eq(message.bdId, bdId),
        inArray(conversation.peerProfileKey, mergedProfileKeysSql(personId)),
        eq(message.isDraft, false),
      ),
    )
    .orderBy(asc(message.sentAt));

  return rows.map((r) => ({
    id: r.id,
    senderName: r.senderName,
    sentAt: r.sentAt,
    content: r.content,
    direction: resolveMessageDirection(r.senderProfileKey, r.peerProfileKey),
  }));
}
