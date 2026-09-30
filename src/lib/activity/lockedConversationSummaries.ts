/**
 * Right-rail "Historial de conversaciones" card, admin-only
 * (admin-conversation-access mockup, screen 1's `assoc` card at
 * admin-conversation.html:138-144). One row per BD this admin currently
 * cannot read this Contact's email conversation with (the same locked
 * `email_sent`/`reply_received` rows the per-row "Ver conversación" action in
 * Timeline.tsx attaches to), with the count of distinct threads — a thread is
 * either a shared `metadata.gmailThreadId` (synced Gmail) or, absent one, the
 * activity row itself (a lone legacy `email_sent`), matching
 * `groupEmailThreads`'s own "shared thread id, else standalone" rule
 * (src/lib/contacts/emailThreads.ts) closely enough for a summary count.
 *
 * One grouped query — bounded by `activity_person_idx`, never a per-BD loop —
 * only ever called for an admin viewer (page.tsx gates the call itself), so a
 * non-admin's page render pays zero extra round trips for this card.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { activity, bd } from "@/db/schema";

export interface LockedConversationSummary {
  bdId: string;
  bdName: string;
  threadCount: number;
}

const CONVERSATION_TYPES: string[] = ["email_sent", "reply_received"];

export async function getLockedConversationSummaries(
  personId: string,
  viewerBdId: string,
): Promise<LockedConversationSummary[]> {
  const rows = await db
    .select({
      bdId: activity.actorBdId,
      bdName: bd.name,
      threadCount: sql<number>`count(distinct coalesce(${activity.metadata}->>'gmailThreadId', ${activity.id}::text))::int`,
    })
    .from(activity)
    .innerJoin(bd, eq(bd.id, activity.actorBdId))
    .where(
      and(
        eq(activity.personId, personId),
        inArray(activity.type, CONVERSATION_TYPES),
        ne(activity.actorBdId, viewerBdId),
      ),
    )
    .groupBy(activity.actorBdId, bd.name)
    .orderBy(bd.name);

  return rows.map((r) => ({ bdId: r.bdId as string, bdName: r.bdName, threadCount: r.threadCount }));
}
