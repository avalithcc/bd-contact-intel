import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, conversation, message, person, personBdConnection, personIdMap } from "@/db/schema";
import { DORMANT_MONTHS, isDormant } from "@/lib/queries";
import {
  getHiringMatchIndex,
  LEADERSHIP_ROLE_GROUPS,
  type HiringMatch,
} from "@/lib/hiring/queries";
import type { MarketKey } from "@/lib/hiring/markets";
import type { RoleGroupKey } from "@/lib/roleGroups";
import type { CompanyCategoryKey } from "@/lib/companyCategories";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { OutreachHistoryMessage } from "./messagePrompt";

// Relationship tiers, highest outreach priority first. Kept as an explicit
// enum (rather than a single opaque "score") so every row's rank traces
// back to a named, explainable bucket — see buildReasons() in
// src/app/outreach/page.tsx.
export const RELATIONSHIP_TIERS = [
  "dormant", // reciprocal, but no message in DORMANT_MONTHS+
  "reciprocal_recent", // reciprocal, active
  "contacted_no_reply", // messaged, but never reciprocal
  "never_messaged", // no messages at all — only ranked in when opted in
] as const;
export type RelationshipTier = (typeof RELATIONSHIP_TIERS)[number];

export function relationshipTierOf(
  reciprocal: boolean,
  dormant: boolean,
  messageCount: number,
): RelationshipTier {
  if (reciprocal && dormant) return "dormant";
  if (reciprocal) return "reciprocal_recent";
  if (messageCount > 0) return "contacted_no_reply";
  return "never_messaged";
}

const TIER_RANK: Record<RelationshipTier, number> = {
  dormant: 0,
  reciprocal_recent: 1,
  contacted_no_reply: 2,
  never_messaged: 3,
};

export interface OutreachFilters {
  roleGroup?: RoleGroupKey;
  // Restricts to contacts whose company falls in this industry category
  // (see src/lib/companyCategories.ts). Applied as a plain SQL WHERE on
  // `contact.company_category`, same as roleGroup below — no extra query.
  companyCategory?: CompanyCategoryKey;
  // Whether "never messaged" contacts are included at all (they always
  // rank last when they are). Default true.
  includeNeverMessaged?: boolean;
  // Restricts the hiring crossover to one market bucket (see
  // src/lib/hiring/markets.ts). Flows into getHiringMatchIndex's SQL WHERE
  // clause — undefined means "all markets" (today's behavior).
  market?: MarketKey;
  // Miami-metro sub-filter, only meaningful alongside `market: "us"` (see
  // src/lib/hiring/markets.ts#isMiamiArea). Flows into getHiringMatchIndex's
  // SQL WHERE clause — same query count either way.
  miamiOnly?: boolean;
  // Opt-in hide for contacts whose company is offshore-heavy (see
  // src/lib/hiring/markets.ts#isOffshoreHeavy). Off by default — see the
  // comment on resolveHiringCompanies' `hideOffshore` param in
  // src/lib/hiring/queries.ts. Flows into getHiringMatchIndex's SQL WHERE
  // clause — same query count either way.
  hideOffshore?: boolean;
  // Opt-in filter to only companies classified as startups (see
  // src/lib/hiring/startupClassification.ts). Off by default. Flows into
  // getHiringMatchIndex's SQL WHERE clause (via resolveHiringCompanies'
  // `startupsOnly` param) — same query count either way. An unclassified
  // company (is_startup IS NULL) is excluded when this is on, same as one
  // confirmed not a startup.
  startupsOnly?: boolean;
  // Free-text match on the contact's first or last name (case-insensitive,
  // substring). Applied as a plain SQL WHERE on `contact`, same as
  // roleGroup/companyCategory above — no extra query.
  name?: string;
}

export interface OutreachRow {
  id: string;
  // False for a teammate-exclusive Contact (see the `id` doc comment on
  // listOutreachCandidates below): `id` then falls back to `person.id`,
  // which the still-bdId-scoped `/contact/[id]` page and
  // generateOutreachMessage don't resolve. UI callers use this explicit flag
  // to hide/disable those two actions (fresh-review UX fix) instead of
  // re-deriving it by comparing ids.
  hasOwnContact: boolean;
  // The unified `person.id` (design D1) — the "view" link (task addition
  // after Phase 9) goes here for every row now that `/contacts/[id]`
  // (design D8) isn't `bdId`-scoped, unlike the legacy `id` field above.
  // Optional: src/lib/whatsnew/queries.ts builds OutreachRow-shaped rows
  // from the legacy `contact` table directly (unmigrated read path, out of
  // this task's scope) and has no unified id to put here yet.
  personId?: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  roleGroup: RoleGroupKey | null;
  messageCount: number;
  lastMessageAt: Date | null;
  reciprocal: boolean;
  dormant: boolean;
  isLeadership: boolean;
  relationshipTier: RelationshipTier;
  // Hiring signal for this contact's company, resolved via the same
  // alias-aware match used on /hiring (see getHiringMatchIndex).
  companyDisplayName: string;
  openItCount: number;
  // This contact's company's open offshore vs. LATAM IT posting counts, and
  // the offshore-heavy verdict derived from them (see
  // HiringMatch.offshoreItCount/latamItCount/offshoreHeavy) — resolved via
  // the same alias-aware match as openItCount above. offshoreHeavy is a
  // deprioritizing signal only (see compareOutreachRows), never used to
  // drop the row; the two counts exist so the badge can show its basis.
  offshoreItCount: number;
  latamItCount: number;
  offshoreHeavy: boolean;
  // Startup classification for this contact's company (see
  // src/lib/hiring/startupClassification.ts), resolved via the same
  // alias-aware match as openItCount above. Null means "not classified
  // yet", distinct from a confirmed `false`. Shown as the "Startup" badge
  // on /outreach, with startupReason as its tooltip.
  isStartup: boolean | null;
  startupReason: string | null;
}

export interface OutreachPage {
  rows: OutreachRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  // Distinct companies currently hiring IT, regardless of whether the BD
  // has any contacts there — lets the empty state distinguish "nothing
  // synced yet" from "synced, but no matching contacts".
  hiringCompanyCount: number;
}

/**
 * Shared ranking rule for "who to contact at this company": dormant
 * reciprocal contacts first, then active reciprocal, then leadership
 * seniority, then hiring urgency — see the numbered steps below. Exported
 * so other views that need the same "who to suggest" idea (see
 * src/lib/whatsnew/queries.ts) sort with this comparator directly instead
 * of re-deriving a second scoring rule.
 */
export function compareOutreachRows(a: OutreachRow, b: OutreachRow): number {
  // 1. Relationship tier: dormant reciprocal contacts first, cold
  // never-messaged contacts last.
  const tierDiff = TIER_RANK[a.relationshipTier] - TIER_RANK[b.relationshipTier];
  if (tierDiff !== 0) return tierDiff;

  // 2. Seniority: leadership role groups outrank everyone else within the
  // same relationship tier.
  if (a.isLeadership !== b.isLeadership) return a.isLeadership ? -1 : 1;

  // 3. More open IT roles at the company = more urgent to reach out.
  if (a.openItCount !== b.openItCount) return b.openItCount - a.openItCount;

  // 4. Tiebreak on recency: for dormant contacts, the longest-overdue goes
  // first (oldest last contact); for everyone else, the most recently
  // active goes first.
  const at = a.lastMessageAt?.getTime() ?? 0;
  const bt = b.lastMessageAt?.getTime() ?? 0;
  if (at !== bt) return a.relationshipTier === "dormant" ? at - bt : bt - at;

  // 5. Lowest-priority tiebreak: a contact whose company is offshore-heavy
  // (see src/lib/hiring/markets.ts#isOffshoreHeavy — strictly more open
  // offshore postings than LATAM ones) sorts after an otherwise-identical
  // one. Deliberately last among the substantive criteria — it must never
  // outrank relationship strength, seniority or hiring urgency above, only
  // break a tie once those are all equal.
  if (a.offshoreHeavy !== b.offshoreHeavy) return a.offshoreHeavy ? 1 : -1;

  return (a.lastName ?? "").localeCompare(b.lastName ?? "");
}

export function isLeadershipRoleGroup(roleGroup: string | null): boolean {
  return !!roleGroup && (LEADERSHIP_ROLE_GROUPS as readonly string[]).includes(roleGroup);
}

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

  // Pre-aggregated to one row per person BEFORE the (fan-out-prone) join to
  // person_id_map/contact below — see the fresh-review fix comment above.
  const pbcAgg = db.$with("pbc_agg").as(
    db
      .select({
        personId: personBdConnection.personId,
        messageCount: sql<number>`sum(${personBdConnection.messageCount})`.as("message_count"),
        lastMessageAt: sql<Date | null>`max(${personBdConnection.lastMessageAt})`.as("last_message_at"),
        reciprocal: sql<boolean>`bool_or(${personBdConnection.reciprocal})`.as("reciprocal"),
      })
      .from(personBdConnection)
      .groupBy(personBdConnection.personId),
  );

  let query = db // query 3
    .with(pbcAgg)
    .select({
      id: sql<string>`coalesce(max(case when ${contact.bdId} = ${bdId} then ${contact.id} end), ${person.id})`,
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
    const dormant = isDormant(r.reciprocal, r.lastMessageAt);
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
      lastMessageAt: r.lastMessageAt,
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

/** Human-readable reason chips for why a row is ranked where it is. */
export function outreachReasons(
  row: OutreachRow,
  relativeTime: (d: Date) => string,
  t: Dictionary,
): string[] {
  const reasons: string[] = [];

  switch (row.relationshipTier) {
    case "dormant":
      reasons.push(
        row.lastMessageAt
          ? t.outreach.reasonDormantSince(relativeTime(row.lastMessageAt), DORMANT_MONTHS)
          : t.outreach.reasonDormant,
      );
      break;
    case "reciprocal_recent":
      reasons.push(
        row.lastMessageAt
          ? t.outreach.reasonReciprocalActive(relativeTime(row.lastMessageAt))
          : t.outreach.reasonReciprocal,
      );
      break;
    case "contacted_no_reply":
      reasons.push(
        row.lastMessageAt
          ? t.outreach.reasonContactedNoReply(relativeTime(row.lastMessageAt))
          : t.outreach.reasonContactedNoReplyGeneric,
      );
      break;
    case "never_messaged":
      reasons.push(t.outreach.reasonNeverMessaged);
      break;
  }

  if (row.roleGroup) reasons.push(t.roleGroups[row.roleGroup]);

  reasons.push(
    t.outreach.reasonOpenRoles(
      row.companyDisplayName || row.company || t.outreach.companyFallback,
      row.openItCount,
    ),
  );

  return reasons;
}
