import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { roleGroupVisibilityCondition } from "@/lib/contacts/roleVisibility";
import { applyLaneFilters, type OutreachLane, type OutreachLaneSummary } from "@/lib/outreach/lanes";
import { termContainsSql } from "@/lib/search/accentInsensitive";
import { db } from "@/db";
import { company, contact, conversation, message, person, personBdConnection, personIdMap } from "@/db/schema";
import { isDormant } from "@/lib/queries";
import { lastActivityRawSql } from "@/lib/contacts/lastActivityRawSql";
import { previousContactRawSql } from "@/lib/contacts/previousContactRawSql";
import type { PreviousContactRaw } from "@/lib/outreach/previousContact";
import { lastContactAtSql } from "@/lib/outreach/lastContact";
import { getHiringMatchIndex, type HiringMatch } from "@/lib/hiring/queries";
import { resolveCompanyDisplayName } from "@/lib/contacts/companyDisplayName";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import type { InlineLastActivityRaw } from "@/lib/contacts/inlineDerivedColumns";
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

/** The Outreach "name" filter: first or last name contains the term, ignoring case and accents. */
export function outreachNameCondition(name: string) {
  return or(termContainsSql(person.firstName, name), termContainsSql(person.lastName, name))!;
}
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
 * Ranked "who should I message this week?" list for one lane (see
 * src/lib/outreach/lanes.ts): `hiring` = Contacts whose company is currently
 * hiring IT, `ready_for_email` = contacted with a verified email (no hiring
 * restriction). Ordered by relationship strength then seniority then
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
 * Exactly 3 fixed statements regardless of page number or total contact count:
 * (1) the single aggregated statement behind getHiringMatchIndex (counts in
 * Postgres, aliases via a correlated subquery; shared with /hiring, not
 * BD-scoped), (2) one `person` query (aggregated over its connections)
 * restricted to the lane's population, and (3) the lane summary
 * (getOutreachLaneSummary). (2) and (3) need only keys known after (1), so they
 * run in parallel: 1 + 1 round trips of wait. The one exception: in the
 * `hiring` lane with a posting filter on (market, miamiOnly, hideOffshore,
 * startupsOnly), the lane badges need the UNFILTERED keys, which costs one more
 * getHiringMatchIndex statement. Scoring, sorting and pagination happen in JS
 * over the single fetched set — no per-row or per-page query. `filters.market`
 * and `filters.startupsOnly` narrow (1) via its SQL WHERE clause, so they never
 * change the statement count of the page itself. `filters.companyCategory`
 * narrows (2) the same way `filters.roleGroup` does — a plain `person`
 * column, no extra query either.
 *
 * Fresh-review fix: the person query (2) used to `leftJoin` `person_bd_connection`
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
  options: OutreachListOptions = {},
): Promise<OutreachPage & { laneSummary: OutreachLaneSummary }> {
  const lane = options.lane ?? "hiring";
  // The lane decides which filters exist: in ready_for_email the posting-derived
  // ones are IGNORED here, not merely hidden by the page.
  const f = applyLaneFilters(lane, filters);
  const includeNeverMessaged = f.includeNeverMessaged ?? true;
  const hiddenRoleGroups = options.hiddenRoleGroups ?? [];

  // Computed in BOTH lanes (openItCount, the "Contratando" badge and the
  // open-roles chip depend on it); applied as a population filter only in `hiring`.
  const hiringIndex =
    options.hiringIndex ?? (await getHiringMatchIndex(f.market, f.miamiOnly, f.hideOffshore, f.startupsOnly)); // statement 1
  const matchKeys = [...hiringIndex.keys()];
  const hiringCompanyCount = new Set(
    [...hiringIndex.values()].map((m) => m.companyKey),
  ).size;

  // The lane badges are UNFILTERED lane sizes. The hiring keys above are narrowed
  // by the posting filters, so when any is on the unfiltered keys cost one more
  // index read; without them (and in ready_for_email) the two sets are the same.
  const postingFilterOn = Boolean(f.market || f.miamiOnly || f.hideOffshore || f.startupsOnly);
  const summaryKeys =
    options.hiringIndex || !postingFilterOn
      ? matchKeys
      : [...(await getHiringMatchIndex(undefined, undefined, undefined, undefined)).keys()];

  if (lane === "hiring" && !matchKeys.length) {
    const laneSummary = await getOutreachLaneSummary(db, summaryKeys, hiddenRoleGroups);
    return { rows: [], total: 0, page: 1, pageSize, totalPages: 1, hiringCompanyCount: 0, laneSummary };
  }

  const where = outreachLaneWhere(lane, matchKeys, hiddenRoleGroups);
  if (f.roleGroup) where.push(eq(person.roleGroup, f.roleGroup));
  if (f.companyCategory) where.push(eq(person.companyCategory, f.companyCategory));
  const name = f.name?.trim();
  if (name) {
    where.push(outreachNameCondition(name));
  }

  // Queries 3 and 4 depend only on keys known by now, so they share one wait.
  const [rows, laneSummary] = await Promise.all([
    selectOutreachRows(db, bdId, and(...where)!, includeNeverMessaged), // statement 2
    getOutreachLaneSummary(db, summaryKeys, hiddenRoleGroups), // statement 3
  ]);

  const scored: OutreachRow[] = rows.map((r) => {
    // A raw-SQL aggregate comes back from the driver as a possibly
    // offset-less string, not a Date — parseDbTimestamp pins it to UTC
    // (src/lib/db/timestamp.ts), the same rule every other raw DB timestamp
    // call site uses.
    const lastMessageAt = r.lastMessageAt == null ? null : parseDbTimestamp(r.lastMessageAt);
    const dormant = isDormant(r.reciprocal, lastMessageAt);
    const hiring: HiringMatch | undefined = r.companyKey
      ? hiringIndex.get(r.companyKey)
      : undefined;
    // Same free-text-wins-fallback rule as the /contacts list (bug fix:
    // Empresa recovery) — resolves the ~quarter of persons with a null
    // `person.company` but a `company_key` that matches a `company` row.
    const resolvedCompany = resolveCompanyDisplayName(r.company, r.companyCanonicalName);
    return {
      id: r.id,
      hasOwnContact: r.hasOwnContact,
      personId: r.personId,
      firstName: r.firstName,
      lastName: r.lastName,
      company: resolvedCompany,
      position: r.position,
      roleGroup: (r.roleGroup ?? null) as RoleGroupKey | null,
      messageCount: r.messageCount,
      lastMessageAt,
      lastActivityRaw: r.lastActivityRaw,
      previousContactRaw: r.previousContactRaw,
      ownerBdId: r.ownerBdId,
      ownerName: r.ownerName,
      reciprocal: r.reciprocal,
      dormant,
      isLeadership: isLeadershipRoleGroup(r.roleGroup),
      relationshipTier: relationshipTierOf(r.reciprocal, dormant, r.messageCount),
      companyDisplayName: hiring?.displayName ?? resolvedCompany ?? "",
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
    laneSummary,
  };
}

export interface OutreachListOptions {
  /** Defaults to `hiring`. */
  lane?: OutreachLane;
  /** Role groups the BD playbook says not to prioritize (resolveRoleVisibility); the BUYER-CHAMPION exception lives in roleGroupVisibilityCondition. */
  hiddenRoleGroups?: readonly RoleGroupKey[];
  /** Test seam: skips the two hiring-index queries. Production never passes it. */
  hiringIndex?: Map<string, HiringMatch>;
}

/**
 * `ready_for_email` population: already contacted AND a verified email.
 * Deliberately does NOT exclude contacts who already received an email: a
 * `contacted` person emailed once who has not replied still needs a follow-up.
 * `probable` (pattern-derived) addresses stay out on purpose.
 */
export const readyForEmailCondition = (): SQL =>
  and(eq(person.status, "contacted"), eq(person.emailStatus, "verified"))!;

/** The population of one lane, shared by the ranked fetch and the lane counts so they cannot drift. */
export function outreachLaneWhere(
  lane: OutreachLane,
  matchKeys: readonly string[],
  hiddenRoleGroups: readonly RoleGroupKey[],
): SQL[] {
  const where: SQL[] = [isNull(person.mergedIntoId)];
  const visibility = roleGroupVisibilityCondition(hiddenRoleGroups);
  if (visibility) where.push(visibility);
  where.push(lane === "hiring" ? inArray(person.companyKey, [...matchKeys]) : readyForEmailCondition());
  return where;
}

/**
 * Both lane sizes plus where the ready lane's "contacted" came from, in ONE
 * statement over the lane populations (no ranked fetch). The three sources
 * are independent `filter (where ...)` counts, so they overlap and need not
 * sum to the lane. `person.id` is literal SQL inside the subqueries: drizzle
 * re-renders a bare column of the outer table wrongly there.
 */
export async function getOutreachLaneSummary(
  database: typeof db,
  matchKeys: readonly string[],
  hiddenRoleGroups: readonly RoleGroupKey[],
): Promise<OutreachLaneSummary> {
  const hiringCond = matchKeys.length ? inArray(person.companyKey, [...matchKeys]) : sql`false`;
  const ready = readyForEmailCondition();
  const visibility = roleGroupVisibilityCondition(hiddenRoleGroups);
  const [r] = await database
    .select({
      hiring: sql<string>`count(*) filter (where ${hiringCond})`,
      ready: sql<string>`count(*) filter (where ${ready})`,
      backfill: sql<string>`count(*) filter (where ${ready} and exists (select 1 from activity ab where ab.person_id = person.id and ab.type = 'status_backfill'))`,
      emailSent: sql<string>`count(*) filter (where ${ready} and exists (select 1 from activity ae where ae.person_id = person.id and ae.type = 'email_sent'))`,
      linkedin: sql<string>`count(*) filter (where ${ready} and exists (select 1 from person_bd_connection pl where pl.person_id = person.id and pl.sent_count > 0))`,
    })
    .from(person)
    .where(and(isNull(person.mergedIntoId), visibility, or(hiringCond, ready)));
  // Aggregates come back from postgres-js as strings.
  return {
    hiring: Number(r!.hiring),
    readyForEmail: Number(r!.ready),
    sources: { backfill: Number(r!.backfill), emailSent: Number(r!.emailSent), linkedin: Number(r!.linkedin) },
  };
}

/**
 * Query 3 of listOutreachCandidates, split out so a db test can run it inside a
 * rolled-back transaction. `where` is the already-built person filter.
 */
export async function selectOutreachRows(
  database: typeof db,
  bdId: string,
  where: SQL,
  includeNeverMessaged: boolean,
) {
  // Aliases are pbc_-prefixed: drizzle references CTE columns unqualified,
  // and `contact` (joined below) has message_count/last_message_at/reciprocal.
  // Pre-aggregated to one row per person BEFORE the (fan-out-prone) join to
  // person_id_map/contact below — see the fresh-review fix comment above.
  const pbcAgg = database.$with("pbc_agg").as(
    database
      .select({
        personId: personBdConnection.personId,
        messageCount: sql<number>`sum(${personBdConnection.messageCount})`.as("pbc_message_count"),
        lastMessageAt: sql<Date | null>`max(${personBdConnection.lastMessageAt})`.as("pbc_last_message_at"),
        reciprocal: sql<boolean>`bool_or(${personBdConnection.reciprocal})`.as("pbc_reciprocal"),
      })
      .from(personBdConnection)
      .groupBy(personBdConnection.personId),
  );

  let query = database
    .with(pbcAgg)
    .select({
      // Postgres has no max(uuid): aggregate the id as text.
      id: sql<string>`coalesce(max(case when ${contact.bdId} = ${bdId} then ${contact.id}::text end), ${person.id}::text)`,
      hasOwnContact: sql<boolean>`coalesce(bool_or(${contact.bdId} = ${bdId}), false)`,
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      // max(): `company.company_key` is the PK (1:1 with the join
      // predicate), but this query is grouped by person.id, and Postgres
      // only infers functional dependency for columns of the SAME table as
      // the GROUP BY key — a joined table's column still needs an aggregate
      // wrapper (bug fix: Empresa recovery, same join every other
      // person-company render now shares, see companyDisplayName.ts).
      companyCanonicalName: sql<string | null>`max(${company.displayName})`,
      companyKey: person.companyKey,
      position: person.jobTitle,
      roleGroup: person.roleGroup,
      messageCount: sql<number>`coalesce(max(${pbcAgg.messageCount}), 0)::int`,
      // Last contact of ANY kind (see lastContact.ts), not the LinkedIn-only date.
      lastMessageAt: sql<Date | null>`${lastContactAtSql(person.id, sql`max(${pbcAgg.lastMessageAt})`)}`,
      // Named newest activity (same subquery as the contacts list). A scalar
      // subquery keyed on person.id: one value per person, no fan-out.
      lastActivityRaw: sql<InlineLastActivityRaw | null>`${lastActivityRawSql(person.id)}`,
      // Which CRM user last had a recorded touch (scalar subquery, no fan-out),
      // and the owner as the labelled fallback. `person.owner_bd_id` is a bare
      // column of the GROUP BY table, so it needs no aggregate wrapper.
      previousContactRaw: sql<PreviousContactRaw | null>`${previousContactRawSql(person.id)}`,
      ownerBdId: person.ownerBdId,
      // Resolved in the statement, not by a roster read: a third statement in the
      // page's parallel wait measured about +1s on this database.
      ownerName: sql<string | null>`(select b.name from bd b where b.id = ${person.ownerBdId})`,
      reciprocal: sql<boolean>`coalesce(bool_or(${pbcAgg.reciprocal}), false)`,
    })
    .from(person)
    .leftJoin(pbcAgg, eq(pbcAgg.personId, person.id))
    .leftJoin(
      personIdMap,
      and(eq(personIdMap.personId, person.id), eq(personIdMap.legacyTable, "contact")),
    )
    .leftJoin(contact, eq(contact.id, personIdMap.legacyId))
    .leftJoin(company, eq(company.companyKey, person.companyKey))
    .where(where)
    .groupBy(person.id)
    .$dynamic();

  if (!includeNeverMessaged) {
    query = query.having(sql`coalesce(max(${pbcAgg.messageCount}), 0) > 0`);
  }

  return await query;
}

