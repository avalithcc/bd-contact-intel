/**
 * Current-state numbers for the LinkedIn messages import screen
 * (`/account/linkedin-messages`): how many messages and conversations the
 * signed-in BD has imported and when the last batch landed.
 *
 * Privacy: `message` and `conversation` rows are private per BD, so every
 * subquery is anchored on `bd_id` (both tables lead their indexes with it:
 * `message_bd_content_hash_unique`, `conversation_bd_external_unique`). The
 * BD id is a bound parameter, never inlined.
 *
 * - `message_count` excludes drafts, like every other message aggregate in
 *   this app (see `message.isDraft` in src/db/schema.ts).
 * - `last_imported_at` is `max(message.created_at)`: the moment the rows were
 *   inserted. There is no import-event column and none is needed. Drafts are
 *   included because they are written by the same import run.
 *
 * ONE statement, three scalar subqueries, so the page pays a single round
 * trip (PERFORMANCE.md). Subqueries use literal table-qualified text rather
 * than `${column}` interpolation, same reason as appShellBadgeCountsQuery.ts.
 * Schema-free so the unit test needs no DATABASE_URL.
 */
import { sql } from "drizzle-orm";

export interface MessageImportStats {
  messageCount: number;
  conversationCount: number;
  lastImportedAt: Date | null;
}

export function buildMessageImportStatsQuery(bdId: string) {
  return sql`select
    (select count(*) from "message" where "message".bd_id = ${bdId}::uuid and "message".is_draft = false) as message_count,
    (select count(*) from "conversation" where "conversation".bd_id = ${bdId}::uuid) as conversation_count,
    (select max("message".created_at) from "message" where "message".bd_id = ${bdId}::uuid) as last_imported_at`;
}

export interface MessageImportStatsRow {
  // count(*) is bigint: the driver may hand it back as a string.
  message_count: number | string;
  conversation_count: number | string;
  // Raw SQL timestamptz arrives as an ISO string or a Date depending on driver.
  last_imported_at: string | Date | null;
}

export function toMessageImportStats(row: MessageImportStatsRow | undefined): MessageImportStats {
  if (!row) return { messageCount: 0, conversationCount: 0, lastImportedAt: null };
  return {
    messageCount: Number(row.message_count),
    conversationCount: Number(row.conversation_count),
    lastImportedAt: row.last_imported_at ? new Date(row.last_imported_at) : null,
  };
}
