import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, conversation, message, person, personBdConnection, personIdMap } from "@/db/schema";
import { isDormant } from "@/lib/queries";
import { getHiringMatchIndex, type HiringMatch } from "@/lib/hiring/queries";
import type { RoleGroupKey } from "@/lib/roleGroups";
import type { OutreachHistoryMessage } from "./messagePrompt";
import {
  compareOutreachRows,
  DORMANT_MONTHS,
  isLeadershipRoleGroup,
  outreachReasons,
  relationshipTierOf,
  RELATIONSHIP_TIERS,
  type OutreachFilters,
  type OutreachPage,
  type OutreachRow,
  type RelationshipTier,
} from "@/lib/outreach/ranking";

// Ranking rule + row/filter/page types moved to the DB-free
// src/lib/outreach/ranking.ts (owner decision 2026-09-26: the `/contacts`
// "Outreach" view — src/lib/contacts/outreachView.ts — reuses these
// directly instead of duplicating the algorithm). Re-exported here so every
// existing consumer of this module keeps working unchanged.
export {
  compareOutreachRows,
  DORMANT_MONTHS,
  isLeadershipRoleGroup,
  outreachReasons,
  relationshipTierOf,
  RELATIONSHIP_TIERS,
};
export type { HiringMatch, OutreachFilters, OutreachPage, OutreachRow, RelationshipTier };

// Fetched one row over messagePrompt's own MAX_HISTORY_MESSAGES cap, so a
// thread with more history than the prompt actually uses is still detected
// (harmless slack, not a truncation signal surfaced anywhere today).
const HISTORY_FETCH_LIMIT = 20;

/**
 * Most recent LinkedIn messages with one contact, oldest-to-newest, scoped
 * to the signed-in BD — feeds buildOutreachMessagePrompt's history-aware
 * rules (see src/lib/outreach/messagePrompt.ts). Direction is derived the
 * same way recomputeMessageSignals derives sent/received (see
 * src/lib/queries.ts): in a 1:1 thread, any non-draft message NOT sent by
 * the peer was sent by the BD. Both `message` and `conversation` are
 * filtered on `bdId` — message content is sensitive, never trust
 * `peerProfileKey` alone (same rule as getConversationThreads).
 */
export async function getRecentOutreachHistory(
  bdId: string,
  peerProfileKey: string,
): Promise<OutreachHistoryMessage[]> {
  const rows = await db
    .select({
      senderProfileKey: message.senderProfileKey,
      sentAt: message.sentAt,
      content: message.content,
    })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(
      and(
        eq(message.bdId, bdId),
        eq(conversation.bdId, bdId),
        eq(conversation.peerProfileKey, peerProfileKey),
        eq(message.isDraft, false),
      ),
    )
    .orderBy(desc(message.sentAt))
    .limit(HISTORY_FETCH_LIMIT);

  return rows.reverse().map((r) => ({
    sentAt: r.sentAt,
    direction: r.senderProfileKey === peerProfileKey ? "received" : "sent",
    content: r.content,
  }));
}

/**
 * Ranked "who should I message this week?" list: Contacts whose company is
 * currently hiring IT, ordered by relationship strength then seniority then
 * hiring urgency (see compareOutreachRows).
 *
 * Re-scoped off `bdId` (task 5.3; proposal success criterion "no `bdId`
 * scoping on Contact queries"; contact-list spec "Central list, no per-BD
 * scoping"): the candidate set is every unified `person` matching a hiring
 * company, not just the calling BD's own address book — a BD now sees
 * teammates' Contacts here too. `messageCount`/`lastMessageAt`/`reciprocal`
 * are aggregated across every connected BD's `person_bd_connection` row
 * (design R4: "combined across BDs"), consistent with how `deriveStatus`
 * already treats connection evidence. `bdId` is kept only to prefer that BD's
 * own legacy `contact` row for `id` (see below) — it is no longer a
 * candidate-set filter.
 *
 * `id` stays the legacy `contact.id` (not `person.id`) so the existing
 * "view"/"generate message" actions (`/contact/[id]`, `generateOutreachMessage`
 * — both still `bdId`-scoped reads, out of this task's scope) keep working
 * unchanged for a BD's own Contacts. When the calling BD has no `contact` row
 * for a person (a teammate-exclusive Contact), `id` falls back to
 * `person.id`, which those two `bdId`-scoped actions will not resolve today
 * — a known, documented gap closed by Phase 9's unified `/contacts/[id]`
 * record page (design D8), not this change.
 *
 * Exactly 3 fixed queries regardless of page number or total contact count:
 * (1)+(2) the two queries behind getHiringMatchIndex (open postings,
 * aliases — shared with /hiring, not BD-scoped), and (3) one `person`
 * query (aggregated over its connections) pre-filtered to only companies
 * with an open IT posting, so the row count stays bounded by the hiring
 * crossover rather than the full Contact base. Scoring, sorting and
 * pagination happen in JS over that single fetched set — no per-row or
 * per-page query. `filters.market` and `filters.startupsOnly` narrow queries
 * (1)-(2) via getHiringMatchIndex's SQL WHERE clause, so the query count
 * stays exactly 3 whether or not they're set. `filters.companyCategory`
 * narrows query (3) the same way `filters.roleGroup` does — a plain `person`
 * column, no extra query either.
 *
 * Fresh-review fix: query (3) used to `leftJoin` `person_bd_connection`
 * directly alongside `person_id_map`/`contact` (also a `leftJoin`, one row
 * per connected BD's own legacy contact row) in the SAME query, so a person
 * connected to N BDs with M legacy contact rows fanned out to N×M rows
 * before `groupBy(person.id)` — inflating `sum(messageCount)` by a factor of
 * M. `pbcAgg` pre-aggregates `person_bd_connection` to exactly one row per
 * person BEFORE it's joined, so the `contact` fan-out (needed only to
 * resolve `id`, see the comment above) can no longer multiply it; the outer
 * query takes `max()` of the already-aggregated value, which is safe against
 * duplicate identical rows.
 */
export async function listOutreachCandidates(
  bdId: string,
  filters: OutreachFilters = {},
  page = 1,
  pageSize = 25,
): Promise<OutreachPage> {
  const includeNeverMessaged = filters.includeNeverMessaged ?? true;

  const hiringIndex = await getHiringMatchIndex(
    filters.market,
    filters.miamiOnly,
    filters.hideOffshore,
    filters.startupsOnly,
  ); // queries 1-2
  const matchKeys = [...hiringIndex.keys()];
  const hiringCompanyCount = new Set(
    [...hiringIndex.values()].map((m) => m.companyKey),
  ).size;

  if (!matchKeys.length) {
    return { rows: [], total: 0, page: 1, pageSize, totalPages: 1, hiringCompanyCount: 0 };
  }

  const where = [isNull(person.mergedIntoId), inArray(person.companyKey, matchKeys)];
  if (filters.roleGroup) where.push(eq(person.roleGroup, filters.roleGroup));
  if (filters.companyCategory) where.push(eq(person.companyCategory, filters.companyCategory));
  const name = filters.name?.trim();
  if (name) {
    const pattern = `%${name}%`;
    where.push(
      or(ilike(person.firstName, pattern), ilike(person.lastName, pattern))!,
    );
  }

  // Aliases are pbc_-prefixed: drizzle references CTE columns unqualified,
  // and `contact` (joined below) has message_count/last_message_at/reciprocal.
  // Pre-aggregated to one row per person BEFORE the (fan-out-prone) join to
  // person_id_map/contact below — see the fresh-review fix comment above.
  const pbcAgg = db.$with("pbc_agg").as(
    db
      .select({
        personId: personBdConnection.personId,
        messageCount: sql<number>`sum(${personBdConnection.messageCount})`.as("pbc_message_count"),
        lastMessageAt: sql<Date | null>`max(${personBdConnection.lastMessageAt})`.as("pbc_last_message_at"),
        reciprocal: sql<boolean>`bool_or(${personBdConnection.reciprocal})`.as("pbc_reciprocal"),
      })
      .from(personBdConnection)
      .groupBy(personBdConnection.personId),
  );

  let query = db // query 3
    .with(pbcAgg)
    .select({
      // Postgres has no max(uuid): aggregate the id as text.
      id: sql<string>`coalesce(max(case when ${contact.bdId} = ${bdId} then ${contact.id}::text end), ${person.id}::text)`,
      hasOwnContact: sql<boolean>`coalesce(bool_or(${contact.bdId} = ${bdId}), false)`,
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      companyKey: person.companyKey,
      position: person.jobTitle,
      roleGroup: person.roleGroup,
      messageCount: sql<number>`coalesce(max(${pbcAgg.messageCount}), 0)::int`,
      lastMessageAt: sql<Date | null>`max(${pbcAgg.lastMessageAt})`,
      reciprocal: sql<boolean>`coalesce(bool_or(${pbcAgg.reciprocal}), false)`,
    })
    .from(person)
    .leftJoin(pbcAgg, eq(pbcAgg.personId, person.id))
    .leftJoin(
      personIdMap,
      and(eq(personIdMap.personId, person.id), eq(personIdMap.legacyTable, "contact")),
    )
    .leftJoin(contact, eq(contact.id, personIdMap.legacyId))
    .where(and(...where))
    .groupBy(person.id)
    .$dynamic();

  if (!includeNeverMessaged) {
    query = query.having(sql`coalesce(max(${pbcAgg.messageCount}), 0) > 0`);
  }

  const rows = await query;

  const scored: OutreachRow[] = rows.map((r) => {
    // A raw-SQL aggregate comes back from the driver as a string, not a Date.
    const lastMessageAt = r.lastMessageAt == null ? null : new Date(r.lastMessageAt);
    const dormant = isDormant(r.reciprocal, lastMessageAt);
    const hiring: HiringMatch | undefined = r.companyKey
      ? hiringIndex.get(r.companyKey)
      : undefined;
    return {
      id: r.id,
      hasOwnContact: r.hasOwnContact,
      personId: r.personId,
      firstName: r.firstName,
      lastName: r.lastName,
      company: r.company,
      position: r.position,
      roleGroup: (r.roleGroup ?? null) as RoleGroupKey | null,
      messageCount: r.messageCount,
      lastMessageAt,
      reciprocal: r.reciprocal,
      dormant,
      isLeadership: isLeadershipRoleGroup(r.roleGroup),
      relationshipTier: relationshipTierOf(r.reciprocal, dormant, r.messageCount),
      companyDisplayName: hiring?.displayName ?? r.company ?? "",
      openItCount: hiring?.openItCount ?? 0,
      isStartup: hiring?.isStartup ?? null,
      startupReason: hiring?.startupReason ?? null,
      offshoreItCount: hiring?.offshoreItCount ?? 0,
      latamItCount: hiring?.latamItCount ?? 0,
      offshoreHeavy: hiring?.offshoreHeavy ?? false,
    };
  });

  scored.sort(compareOutreachRows);

  const total = scored.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = scored.slice((safePage - 1) * pageSize, safePage * pageSize);

  return {
    rows: pageRows,
    total,
    page: safePage,
    pageSize,
    totalPages,
    hiringCompanyCount,
  };
}

