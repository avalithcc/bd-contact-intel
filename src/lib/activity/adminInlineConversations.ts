/**
 * What an admin reads inline in a contact's timeline: other BDs' synced mail
 * bodies and LinkedIn messages with this contact (owner decision 2026-10-15:
 * visible from the start, no click, NO audit row — the only writer this module
 * has is none). Replaces the audited getConversationForAdmin.
 *
 * Includes synced mail that no `activity` row covers (the send path stores one
 * email_message for every matched person but writes its activity for one), flagged
 * `orphan` by a NOT EXISTS on activity_person_idx, so nothing the old dialog listed is lost.
 *
 * Cost: ONE statement (UNION ALL of the two sources), one round trip, only for
 * an admin viewer. Bounded three ways: LIMIT rowLimit + 1 on the whole union,
 * a per-body cap in SQL (`left(...)`, so a 256 KB body never leaves Postgres),
 * and the LinkedIn side is restricted to the BD ids the page already holds from
 * `person_bd_connection` so it stays on conversation_bd_peer_idx instead of a
 * `bd_id <> me` scan. Worst case payload: (100 + 1) rows x 4,000 chars ~ 400 KB.
 * The mail side starts from email_message_person_person_idx.
 *
 * The role check lives HERE, not only in the page: a non-admin gets the empty
 * result no matter what the caller passes, so no body can reach a payload.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, conversation, emailMessage, emailMessagePerson, message } from "@/db/schema";
import { isAdminRole } from "@/lib/auth/adminRole";
import { mergedProfileKeysAnyCondition } from "@/lib/identity/mergedProfileKeys";
import {
  EMPTY_INLINE_CONVERSATIONS,
  groupInlineRows,
  type AdminInlineConversations,
  type InlineRow,
} from "@/lib/activity/inlineConversationGroups";

export const INLINE_ROW_LIMIT = 100;
export const INLINE_BODY_CHARS = 4000;
const cap = sql.raw(String(INLINE_BODY_CHARS));

export async function getAdminInlineConversations(
  viewer: { id: string; role: string },
  personId: string,
  linkedinBdIds: readonly string[],
  opts: { rowLimit?: number } = {},
): Promise<AdminInlineConversations> {
  if (!isAdminRole(viewer)) return EMPTY_INLINE_CONVERSATIONS;
  const rowLimit = opts.rowLimit ?? INLINE_ROW_LIMIT;
  const foreignBds = linkedinBdIds.filter((id) => id !== viewer.id);

  const mail = db
    .select({
      kind: sql<string>`'email'`.as("aic_kind"),
      bdId: sql<string>`${emailMessage.bdId}`.as("aic_bd"),
      group: sql<string>`${emailMessage.gmailThreadId}`.as("aic_group"),
      ref: sql<string>`${emailMessage.gmailMessageId}`.as("aic_ref"),
      at: sql<Date>`${emailMessage.sentAt}`.mapWith(emailMessage.sentAt).as("aic_at"),
      who: sql<string | null>`${bd.name}`.as("aic_who"),
      body: sql<string | null>`left(${emailMessage.bodyText}, ${cap})`.as("aic_body"),
      truncated: sql<boolean>`(${emailMessage.bodyTruncated} or char_length(${emailMessage.bodyText}) > ${cap})`.as("aic_trunc"),
      direction: sql<string | null>`${emailMessage.direction}`.as("aic_dir"),
      subject: sql<string | null>`${emailMessage.subject}`.as("aic_subject"),
      addr: sql<string | null>`case when ${emailMessage.direction} = 'outbound' and jsonb_typeof(${emailMessage.toAddresses}) = 'array'
        then (select string_agg(a, ', ') from jsonb_array_elements_text(${emailMessage.toAddresses}) a)
        else ${emailMessage.fromAddress} end`.as("aic_addr"),
      // Literal qualified SQL text, not ${} interpolation: PERFORMANCE.md's Drizzle 0.36.4 correlated-subquery gotcha.
      orphan: sql<boolean>`not exists (
        select 1 from activity
        where activity.person_id = ${personId}::uuid
          and activity.actor_bd_id = email_message.bd_id
          and activity.metadata->>'gmailMessageId' = email_message.gmail_message_id
      )`.as("aic_orphan"),
    })
    .from(emailMessage)
    .innerJoin(emailMessagePerson, eq(emailMessagePerson.emailMessageId, emailMessage.id))
    .innerJoin(bd, eq(bd.id, emailMessage.bdId))
    .where(and(eq(emailMessagePerson.personId, personId), ne(emailMessage.bdId, viewer.id)));

  const linkedin = db
    .select({
      kind: sql<string>`'linkedin'`.as("aic_kind"),
      bdId: sql<string>`${conversation.bdId}`.as("aic_bd"),
      group: sql<string>`${conversation.id}::text`.as("aic_group"),
      ref: sql<string>`${message.id}::text`.as("aic_ref"),
      at: sql<Date>`${message.sentAt}`.mapWith(emailMessage.sentAt).as("aic_at"),
      who: sql<string | null>`${message.senderName}`.as("aic_who"),
      body: sql<string | null>`left(${message.content}, ${cap})`.as("aic_body"),
      truncated: sql<boolean>`(char_length(${message.content}) > ${cap})`.as("aic_trunc"),
      direction: sql<string | null>`null::text`.as("aic_dir"),
      subject: sql<string | null>`null::text`.as("aic_subject"),
      addr: sql<string | null>`null::text`.as("aic_addr"),
      orphan: sql<boolean>`false`.as("aic_orphan"),
    })
    .from(conversation)
    .innerJoin(
      message,
      // bd_id too: message's only useful index is (bd_id, conversation_id, sent_at).
      and(eq(message.conversationId, conversation.id), eq(message.bdId, conversation.bdId)),
    )
    .where(
      and(
        foreignBds.length ? inArray(conversation.bdId, foreignBds) : sql`false`,
        mergedProfileKeysAnyCondition(personId),
        eq(message.isDraft, false),
      ),
    );

  const rows = (await mail
    .unionAll(linkedin)
    .orderBy(desc(sql`aic_at`))
    .limit(rowLimit + 1)) as InlineRow[];
  return groupInlineRows(rows, rowLimit);
}
