import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bd,
  companyAlias,
  companyCategory,
  contact,
  conversation,
  message,
  type NewContact,
} from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { classifyPosition, type RoleGroupKey } from "@/lib/roleGroups";
import {
  normalizeCompanyKey,
  type CompanyCategoryKey,
} from "@/lib/companyCategories";
import { bucketTopN } from "@/lib/bucketing";
import { partitionOwnCompanyRows } from "@/lib/ownCompany";
import type { ParseMessagesResult } from "@/lib/messagesCsv";
import {
  contactRowsToIdentityRows,
  runIdentityCutoverChunk,
  type InsertedContactRow,
} from "@/lib/identity/ingestWrite";
import { isIdentityDualWriteEnabled } from "@/lib/identity/resolve";
import { applyIdentityWrites, prefetchIdentityIndex, withIdentityLock } from "@/lib/identity/resolveDb";
import { recomputePersonStatuses } from "@/lib/status/recompute";

/**
 * Resolves the current BD from the authenticated Supabase user, creating the
 * `bd` row on first sign-in. Callers run behind middleware that redirects
 * unauthenticated requests to /login, so a missing user is an error here.
 */
export async function getCurrentBd() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Not authenticated");

  const existing = await db.query.bd.findFirst({
    where: eq(bd.email, user.email),
  });
  if (existing) return existing;
  // A first visit renders several server components that each call this
  // concurrently, so two of them can miss the lookup above and race to
  // insert. The no-op upsert makes the loser return the winner's row
  // instead of failing on bd_email_unique.
  const [created] = await db
    .insert(bd)
    .values({ name: user.email.split("@")[0], email: user.email })
    .onConflictDoUpdate({ target: bd.email, set: { email: user.email } })
    .returning();
  return created;
}

/**
 * The authenticated Supabase auth user's id — distinct from `bd.id` (a
 * separate, app-level uuid). Used to validate that a Storage object path
 * uploaded by the browser (see src/app/actions.ts#uploadMessagesCsv)
 * actually belongs to the caller before the server touches it.
 */
export async function getCurrentAuthUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// Relationship signal derived from imported LinkedIn messages (see
// src/lib/messagesCsv.ts and #recomputeMessageSignals below). "dormant" is
// computed in JS at read time (reciprocal + no message in DORMANT_MONTHS)
// rather than stored, since "now" moves — see isDormant().
// Display labels are localized — see src/lib/i18n/dictionaries/{en,es}.ts
// (`relationshipFilters` record), keyed by the same key so the key list
// lives in exactly one place.
export const RELATIONSHIP_FILTERS = [
  { key: "reciprocal" },
  { key: "dormant" },
  { key: "never" },
] as const;
export type RelationshipFilterKey = (typeof RELATIONSHIP_FILTERS)[number]["key"];

// Exported so other views that need the same "reciprocal but gone quiet"
// signal (see src/lib/outreach/queries.ts) compute it identically instead of
// re-deriving their own threshold.
export const DORMANT_MONTHS = 12;

export interface ContactFilters {
  // Single free-text search box on the home page (param `q`), matching
  // "anything" about the contact — see searchCondition() below for the
  // exact semantics.
  q?: string;
  roleGroup?: RoleGroupKey;
  companyCategory?: CompanyCategoryKey;
  // Exact match on the normalized company key (see
  // src/lib/companyCategories.ts#normalizeCompanyKey), used by the /hiring
  // "N contacts" link to jump straight to a specific company's contacts
  // rather than relying on free-text `company` matching.
  companyKey?: string;
  relationship?: RelationshipFilterKey;
}

export interface ContactRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  companyKey: string | null;
  profileKey: string;
  overlapWith: string[]; // names of other BDs who also hold this contact
  // Denormalized message signals (see #recomputeMessageSignals) — already
  // on the `contact` row, so the home list needs no extra per-row query.
  messageCount: number;
  lastMessageAt: Date | null;
  reciprocal: boolean;
  dormant: boolean;
}

export function isDormant(reciprocal: boolean, lastMessageAt: Date | null): boolean {
  if (!reciprocal || !lastMessageAt) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - DORMANT_MONTHS);
  return lastMessageAt < cutoff;
}

function relationshipFilterCondition(key: RelationshipFilterKey) {
  switch (key) {
    case "reciprocal":
      return eq(contact.reciprocal, true);
    case "never":
      return eq(contact.messageCount, 0);
    case "dormant": {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - DORMANT_MONTHS);
      // Composed as one SQL fragment: `and()` is typed as possibly
      // undefined, which does not fit the non-optional filter list.
      return sql`${contact.reciprocal} = true and ${contact.lastMessageAt} < ${cutoff}`;
    }
  }
}

export interface ContactsPage {
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Resolve the names of other BDs who also hold each of the given profile keys. */
async function overlapByProfileKey(
  bdId: string,
  keys: string[],
): Promise<Map<string, string[]>> {
  const overlap = new Map<string, string[]>();
  if (!keys.length) return overlap;
  const others = await db
    .select({ profileKey: contact.profileKey, name: bd.name })
    .from(contact)
    .innerJoin(bd, eq(contact.bdId, bd.id))
    .where(
      and(inArray(contact.profileKey, keys), sql`${contact.bdId} <> ${bdId}`),
    );
  for (const o of others) {
    const list = overlap.get(o.profileKey) ?? [];
    list.push(o.name);
    overlap.set(o.profileKey, list);
  }
  return overlap;
}

/**
 * Alias-aware `companyKey` filter. The `/hiring` page's "N contacts" count
 * includes contacts matched via `company_alias` (see
 * src/lib/hiring/queries.ts#getCompanyHiringSummaries), so the deep link's
 * contact list must match on the same set or the two numbers disagree.
 *
 * `key` may itself be a canonical `target_company.company_key` or a
 * `company_alias.alias_key` (both link shapes should behave the same), so
 * this first resolves it to its canonical key, then matches
 * `contact.company_key` against that canonical key plus every alias of it —
 * all via one `IN (SELECT ...)` subquery folded into the caller's query, so
 * it doesn't add a round trip.
 */
export function companyKeyFilter(key: string) {
  const canonicalKey = sql`coalesce((select ${companyAlias.companyKey} from ${companyAlias} where ${companyAlias.aliasKey} = ${key}), ${key})`;
  return sql`${contact.companyKey} in (
    select ${companyAlias.aliasKey} from ${companyAlias} where ${companyAlias.companyKey} = (${canonicalKey})
    union
    select (${canonicalKey})
  )`;
}

// Cap on whitespace-separated search tokens in `q`, so a pathological
// paste-in doesn't blow up the query into dozens of OR'd conditions.
const MAX_SEARCH_TOKENS = 5;

// Escapes LIKE/ILIKE wildcard characters (and the escape character itself)
// so literal `%`, `_`, or `\` in a user's search term are matched as-is
// instead of behaving as wildcards.
const LIKE_WILDCARD_RE = /[%_\\]/g;
function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

/**
 * Builds the home page's single-box `q` search filter: every
 * whitespace-separated token in `q` (trimmed, capped at
 * MAX_SEARCH_TOKENS) must match SOME searchable column (AND across
 * tokens, OR across columns) — first name, last name, company, position,
 * email, industry. A query like "juan perez" therefore matches first and
 * last name separately. Returns undefined when `q` has no tokens
 * (e.g. blank/whitespace-only), so callers can skip pushing a filter.
 */
function searchCondition(q: string) {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
  if (!tokens.length) return undefined;

  const tokenConditions = tokens.map((token) => {
    const pattern = `%${escapeLikeWildcards(token)}%`;
    return or(
      ilike(contact.firstName, pattern),
      ilike(contact.lastName, pattern),
      ilike(contact.company, pattern),
      ilike(contact.position, pattern),
      ilike(contact.email, pattern),
      ilike(contact.industry, pattern),
    );
  });

  return and(...tokenConditions);
}

export async function listContacts(
  bdId: string,
  filters: ContactFilters = {},
  page = 1,
  pageSize = 20,
): Promise<ContactsPage> {
  const where = [eq(contact.bdId, bdId)];
  if (filters.q) {
    const q = searchCondition(filters.q);
    if (q) where.push(q);
  }
  if (filters.roleGroup) where.push(eq(contact.roleGroup, filters.roleGroup));
  if (filters.companyCategory)
    where.push(eq(contact.companyCategory, filters.companyCategory));
  if (filters.companyKey) where.push(companyKeyFilter(filters.companyKey));
  if (filters.relationship) where.push(relationshipFilterCondition(filters.relationship));

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contact)
    .where(and(...where));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const rows = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      position: contact.position,
      companyKey: contact.companyKey,
      profileKey: contact.profileKey,
      messageCount: contact.messageCount,
      lastMessageAt: contact.lastMessageAt,
      reciprocal: contact.reciprocal,
    })
    .from(contact)
    .where(and(...where))
    .orderBy(contact.lastName)
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const overlap = await overlapByProfileKey(
    bdId,
    rows.map((r) => r.profileKey),
  );

  return {
    rows: rows.map((r) => ({
      ...r,
      overlapWith: overlap.get(r.profileKey) ?? [],
      dormant: isDormant(r.reciprocal, r.lastMessageAt),
    })),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export interface ContactDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  companyKey: string | null;
  email: string | null;
  industry: string | null;
  connectedOn: string | null;
  profileKey: string;
  createdAt: Date;
  overlapWith: string[];
  messageCount: number;
  sentCount: number;
  receivedCount: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  initiatedByMe: boolean | null;
  reciprocal: boolean;
  dormant: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Full detail for one contact, scoped to the owning BD. Null if not found/owned. */
export async function getContactById(
  bdId: string,
  id: string,
): Promise<ContactDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db
    .select()
    .from(contact)
    .where(and(eq(contact.bdId, bdId), eq(contact.id, id)))
    .limit(1);
  if (!row) return null;

  const overlap = await overlapByProfileKey(bdId, [row.profileKey]);
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    position: row.position,
    companyKey: row.companyKey,
    email: row.email,
    industry: row.industry,
    connectedOn: row.connectedOn,
    profileKey: row.profileKey,
    createdAt: row.createdAt,
    overlapWith: overlap.get(row.profileKey) ?? [],
    messageCount: row.messageCount,
    sentCount: row.sentCount,
    receivedCount: row.receivedCount,
    firstMessageAt: row.firstMessageAt,
    lastMessageAt: row.lastMessageAt,
    initiatedByMe: row.initiatedByMe,
    reciprocal: row.reciprocal,
    dormant: isDormant(row.reciprocal, row.lastMessageAt),
  };
}

/**
 * Resolve `company_category` for a batch of company names in ONE query,
 * rather than looking up each row individually. Blank/null company maps to
 * "no_company"; a non-blank company whose normalized key isn't in the
 * mapping table maps to "unclassified" (e.g. future imports from other BDs
 * whose network hasn't been mapped yet).
 */
async function resolveCompanyCategories(
  companies: (string | null | undefined)[],
): Promise<Map<string | null | undefined, CompanyCategoryKey>> {
  const result = new Map<string | null | undefined, CompanyCategoryKey>();
  const keyToCompanies = new Map<string, Set<string | null | undefined>>();

  for (const company of companies) {
    if (result.has(company)) continue;
    const trimmed = company?.trim();
    if (!trimmed) {
      result.set(company, "no_company");
      continue;
    }
    const key = normalizeCompanyKey(trimmed);
    if (!key) {
      result.set(company, "unclassified");
      continue;
    }
    const set = keyToCompanies.get(key) ?? new Set();
    set.add(company);
    keyToCompanies.set(key, set);
  }

  const keys = [...keyToCompanies.keys()];
  if (keys.length) {
    const mapped = await db
      .select({ key: companyCategory.key, category: companyCategory.category })
      .from(companyCategory)
      .where(inArray(companyCategory.key, keys));
    const foundKeys = new Set<string>();
    for (const row of mapped) {
      foundKeys.add(row.key);
      for (const company of keyToCompanies.get(row.key) ?? []) {
        result.set(company, row.category as CompanyCategoryKey);
      }
    }
    for (const key of keys) {
      if (foundKeys.has(key)) continue;
      for (const company of keyToCompanies.get(key) ?? []) {
        result.set(company, "unclassified");
      }
    }
  }

  return result;
}

export interface UpsertContactsResult {
  imported: number;
  // Rows dropped because they belong to Avalith itself (a BD's own
  // coworker, pulled in incidentally by whatever source produced `rows` —
  // LinkedIn connections today, potentially a scrape or a third-party CSV
  // tomorrow). See src/lib/ownCompany.ts.
  skippedOwnCompany: number;
}

/**
 * Upsert a batch of contact rows into a BD's private base.
 *
 * This is the single insert path every contact-ingestion source (LinkedIn
 * Connections.csv today; future scrapes or third-party CSV imports) must go
 * through — so the own-company guard lives here rather than in any one
 * source's parser, and applies no matter what produces `rows`.
 */
export async function upsertContacts(
  bdId: string,
  rows: Omit<NewContact, "bdId">[],
): Promise<UpsertContactsResult> {
  if (!rows.length) return { imported: 0, skippedOwnCompany: 0 };
  const { kept: filteredRows, skipped: ownRows } = partitionOwnCompanyRows(rows);
  const skippedOwnCompany = ownRows.length;
  if (!filteredRows.length) return { imported: 0, skippedOwnCompany };

  let count = 0;
  // chunk to keep parameter counts sane
  const chunkSize = 500;
  for (let i = 0; i < filteredRows.length; i += chunkSize) {
    const rowsChunk = filteredRows.slice(i, i + chunkSize);
    const categories = await resolveCompanyCategories(
      rowsChunk.map((r) => r.company),
    );
    const chunk = rowsChunk.map((r) => {
      const trimmedCompany = r.company?.trim();
      return {
        ...r,
        bdId,
        roleGroup: classifyPosition(r.position),
        companyCategory: categories.get(r.company) ?? "unclassified",
        companyKey: trimmedCompany ? normalizeCompanyKey(trimmedCompany) : null,
      };
    });
    // One transaction per chunk (design D14): the legacy upsert plus the
    // identity resolver's lock/prefetch/match/write, or — when
    // IDENTITY_DUAL_WRITE is off — the legacy upsert alone, byte-identical
    // to pre-cutover behavior. See src/lib/identity/ingestWrite.ts.
    const dualWriteEnabled = isIdentityDualWriteEnabled();
    await db.transaction(async (tx) => {
      // Same insert either way; `.returning()` is only appended when the
      // identity resolver actually needs the inserted/updated rows, so the
      // kill-switch-off path stays the exact original statement (D11:
      // byte-identical to pre-cutover behavior, including query text).
      const upsertContactRows = () =>
        tx
          .insert(contact)
          .values(chunk)
          .onConflictDoUpdate({
            target: [contact.bdId, contact.profileKey],
            set: {
              firstName: sql`excluded.first_name`,
              lastName: sql`excluded.last_name`,
              company: sql`excluded.company`,
              position: sql`excluded.position`,
              roleGroup: sql`excluded.role_group`,
              companyCategory: sql`excluded.company_category`,
              companyKey: sql`excluded.company_key`,
              email: sql`excluded.email`,
              connectedOn: sql`excluded.connected_on`,
            },
          });
      await runIdentityCutoverChunk(dualWriteEnabled, {
        withLock: (fn) => withIdentityLock(tx, fn),
        legacyWrite: dualWriteEnabled
          ? () =>
              upsertContactRows().returning({
                id: contact.id,
                bdId: contact.bdId,
                profileKey: contact.profileKey,
                firstName: contact.firstName,
                lastName: contact.lastName,
                company: contact.company,
                companyKey: contact.companyKey,
                position: contact.position,
                industry: contact.industry,
                connectedOn: contact.connectedOn,
                email: contact.email,
                emailStatus: contact.emailStatus,
                emailConfidence: contact.emailConfidence,
                emailSource: contact.emailSource,
              })
          : () => upsertContactRows().then(() => [] as InsertedContactRow[]),
        toIdentityRows: contactRowsToIdentityRows,
        prefetch: (rows) => prefetchIdentityIndex(tx, rows),
        apply: (plan) => applyIdentityWrites(tx, plan),
      });
    });
    count += chunk.length;
  }
  return { imported: count, skippedOwnCompany };
}

export interface PositionTitleCount {
  position: string;
  count: number;
}

export interface RoleGroupSummary {
  count: number;
  titles: PositionTitleCount[];
  totalDistinctTitles: number;
}

/**
 * Per-role-group contact counts plus the most frequent real `Position`
 * titles in each group, scoped to one BD's own base. Computed from a single
 * `GROUP BY role_group, position` query (instead of one count query plus one
 * per-group titles query) to keep the home page's query count constant
 * regardless of how many role groups exist. Bucketing/top-N slicing happens
 * in JS via `bucketTopN` (see src/lib/bucketing.ts).
 *
 * Null `position` rows still count toward `count` and `totalDistinctTitles`
 * (matching the previous per-group behavior) but are excluded from `titles`,
 * since a null title has nothing useful to display.
 */
export async function getRoleGroupSummaries(
  bdId: string,
  limit = 50,
): Promise<Map<RoleGroupKey, RoleGroupSummary>> {
  const rows = await db
    .select({
      roleGroup: contact.roleGroup,
      position: contact.position,
      count: sql<number>`count(*)::int`,
    })
    .from(contact)
    .where(eq(contact.bdId, bdId))
    .groupBy(contact.roleGroup, contact.position);

  const buckets = new Map<
    RoleGroupKey,
    { count: number; distinct: number; titles: PositionTitleCount[] }
  >();
  for (const r of rows) {
    const key = (r.roleGroup ?? "no_position") as RoleGroupKey;
    const bucket = buckets.get(key) ?? { count: 0, distinct: 0, titles: [] };
    bucket.count += r.count;
    bucket.distinct += 1;
    if (r.position !== null) bucket.titles.push({ position: r.position, count: r.count });
    buckets.set(key, bucket);
  }

  const result = new Map<RoleGroupKey, RoleGroupSummary>();
  for (const [key, bucket] of buckets) {
    result.set(key, {
      count: bucket.count,
      titles: bucketTopN(bucket.titles, (t) => t.position, limit),
      totalDistinctTitles: bucket.distinct,
    });
  }
  return result;
}

export interface CompanyNameCount {
  company: string;
  count: number;
}

export interface CompanyCategorySummary {
  count: number;
  companies: CompanyNameCount[];
  totalDistinctCompanies: number;
}

/**
 * Per-company-category contact counts plus the most frequent real company
 * names in each category, scoped to one BD's own base. Computed from a
 * single `GROUP BY company_category, company` query (instead of one count
 * query plus one per-category companies query) to keep the home page's
 * query count constant regardless of how many categories exist.
 * Bucketing/top-N slicing happens in JS via `bucketTopN`.
 *
 * Null/blank `company` rows still count toward `count` and
 * `totalDistinctCompanies` (matching the previous per-category behavior) but
 * are excluded from `companies`, since a blank company name has nothing
 * useful to display.
 */
export async function getCompanyCategorySummaries(
  bdId: string,
  limit = 50,
): Promise<Map<CompanyCategoryKey, CompanyCategorySummary>> {
  const rows = await db
    .select({
      companyCategory: contact.companyCategory,
      company: contact.company,
      count: sql<number>`count(*)::int`,
    })
    .from(contact)
    .where(eq(contact.bdId, bdId))
    .groupBy(contact.companyCategory, contact.company);

  const buckets = new Map<
    CompanyCategoryKey,
    { count: number; distinct: number; companies: CompanyNameCount[] }
  >();
  for (const r of rows) {
    const key = (r.companyCategory ?? "unclassified") as CompanyCategoryKey;
    const bucket = buckets.get(key) ?? { count: 0, distinct: 0, companies: [] };
    bucket.count += r.count;
    bucket.distinct += 1;
    if (r.company) bucket.companies.push({ company: r.company, count: r.count });
    buckets.set(key, bucket);
  }

  const result = new Map<CompanyCategoryKey, CompanyCategorySummary>();
  for (const [key, bucket] of buckets) {
    result.set(key, {
      count: bucket.count,
      companies: bucketTopN(bucket.companies, (c) => c.company, limit),
      totalDistinctCompanies: bucket.distinct,
    });
  }
  return result;
}

/**
 * Import a parsed messages.csv (see src/lib/messagesCsv.ts#parseMessagesCsv)
 * into one BD's private base:
 *  1. Upsert conversations (chunked), keyed on (bd_id, external_id).
 *  2. Look up the external-id -> uuid mapping once (one query, not per row).
 *  3. Insert messages (chunked), idempotent via
 *     `ON CONFLICT (bd_id, content_hash) DO NOTHING` so re-importing the
 *     same export never duplicates rows.
 *  4. Recompute conversation and contact aggregates in bulk (see
 *     #recomputeMessageSignals) — never per row.
 *
 * Messages whose conversation failed to upsert (shouldn't happen, but keeps
 * this defensive) are skipped rather than throwing.
 */
export async function importMessages(
  bdId: string,
  parsed: ParseMessagesResult,
): Promise<{ conversations: number; messages: number }> {
  const { conversations: convRows, messages: msgRows } = parsed;
  if (!convRows.length) return { conversations: 0, messages: 0 };

  const CHUNK = 500;

  for (let i = 0; i < convRows.length; i += CHUNK) {
    const chunk = convRows.slice(i, i + CHUNK).map((c) => ({
      bdId,
      externalId: c.externalId,
      title: c.title,
      peerProfileKey: c.peerProfileKey,
    }));
    await db
      .insert(conversation)
      .values(chunk)
      .onConflictDoUpdate({
        target: [conversation.bdId, conversation.externalId],
        set: {
          title: sql`excluded.title`,
          peerProfileKey: sql`excluded.peer_profile_key`,
        },
      });
  }

  const idRows = await db
    .select({ id: conversation.id, externalId: conversation.externalId })
    .from(conversation)
    .where(eq(conversation.bdId, bdId));
  const idByExternal = new Map(idRows.map((r) => [r.externalId, r.id]));

  let inserted = 0;
  for (let i = 0; i < msgRows.length; i += CHUNK) {
    const chunk = msgRows
      .slice(i, i + CHUNK)
      .map((m) => {
        const conversationId = idByExternal.get(m.externalConversationId);
        if (!conversationId) return null;
        return {
          bdId,
          conversationId,
          senderProfileKey: m.senderProfileKey,
          senderName: m.senderName,
          sentAt: m.sentAt,
          subject: m.subject,
          content: m.content,
          folder: m.folder,
          isDraft: m.isDraft,
          contentHash: m.contentHash,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (!chunk.length) continue;
    const result = await db
      .insert(message)
      .values(chunk)
      .onConflictDoNothing({ target: [message.bdId, message.contentHash] })
      .returning({ id: message.id });
    inserted += result.length;
  }

  await recomputeMessageSignals(bdId);

  return { conversations: convRows.length, messages: inserted };
}

/**
 * Recompute conversation and contact message signals for one BD, in two
 * bulk statements (one per aggregate level) rather than per row/per
 * conversation. Idempotent — safe to call after every import, including
 * partial/no-op ones.
 *
 * Sent vs. received is derived from `conversation.peer_profile_key` rather
 * than a stored "own profile" column: in a 1:1 thread there are only two
 * parties, so any non-draft message NOT sent by the peer was sent by the
 * BD. This is also why group threads (peer_profile_key IS NULL) are
 * excluded from contact aggregation — they can't be attributed to a single
 * contact.
 *
 * Wrapped in one transaction (task 5.2) so the person-side aggregate update
 * and the status-cache recompute it feeds (design D4: a connection's
 * sent/received counts are stage evidence) land atomically. The
 * affected-person status recompute (fresh-review fix) is one batched call
 * to `recomputePersonStatuses` — one bulk read of `activity`/
 * `person_bd_connection` per chunk, `deriveStatus` run in memory per person,
 * and one `UPDATE ... FROM (VALUES ...)` per chunk — not a per-person loop.
 */
export async function recomputeMessageSignals(bdId: string): Promise<void> {
  return db.transaction((tx) => recomputeMessageSignalsInTx(tx, bdId));
}

type RecomputeTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function recomputeMessageSignalsInTx(tx: RecomputeTx, bdId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE conversation c
    SET
      message_count = agg.message_count,
      received_count = agg.received_count,
      sent_count = agg.message_count - agg.received_count,
      first_message_at = agg.first_message_at,
      last_message_at = agg.last_message_at
    FROM (
      SELECT
        m.conversation_id,
        count(*)::int AS message_count,
        count(*) FILTER (
          WHERE m.sender_profile_key IS NOT NULL
            AND m.sender_profile_key = c2.peer_profile_key
        )::int AS received_count,
        min(m.sent_at) AS first_message_at,
        max(m.sent_at) AS last_message_at
      FROM message m
      JOIN conversation c2 ON c2.id = m.conversation_id
      WHERE m.bd_id = ${bdId} AND m.is_draft = false
      GROUP BY m.conversation_id
    ) agg
    WHERE c.id = agg.conversation_id AND c.bd_id = ${bdId}
  `);

  await tx.execute(sql`
    WITH first_msg AS (
      SELECT DISTINCT ON (c.peer_profile_key)
        c.peer_profile_key,
        (m.sender_profile_key IS DISTINCT FROM c.peer_profile_key) AS initiated_by_me
      FROM message m
      JOIN conversation c ON c.id = m.conversation_id
      WHERE m.bd_id = ${bdId} AND m.is_draft = false AND c.peer_profile_key IS NOT NULL
      ORDER BY c.peer_profile_key, m.sent_at ASC
    ),
    peer_agg AS (
      SELECT
        peer_profile_key,
        sum(message_count)::int AS message_count,
        sum(sent_count)::int AS sent_count,
        sum(received_count)::int AS received_count,
        min(first_message_at) AS first_message_at,
        max(last_message_at) AS last_message_at
      FROM conversation
      WHERE bd_id = ${bdId} AND peer_profile_key IS NOT NULL
      GROUP BY peer_profile_key
    )
    UPDATE contact ct
    SET
      message_count = pa.message_count,
      sent_count = pa.sent_count,
      received_count = pa.received_count,
      first_message_at = pa.first_message_at,
      last_message_at = pa.last_message_at,
      initiated_by_me = fm.initiated_by_me,
      reciprocal = (pa.sent_count > 0 AND pa.received_count > 0)
    FROM peer_agg pa
    LEFT JOIN first_msg fm ON fm.peer_profile_key = pa.peer_profile_key
    WHERE ct.bd_id = ${bdId} AND ct.profile_key = pa.peer_profile_key
  `);

  if (!isIdentityDualWriteEnabled()) return;

  // Same per-BD aggregates, now also applied to the unified person's
  // per-BD connection row (design "Reference writes": "recomputeMessageSignals
  // gets a second set-based UPDATE person_bd_connection … FROM peer_agg JOIN
  // person_id_map"). DB-only glue — no matcher, no lock, this never creates
  // a person or a connection, only updates one that already exists.
  const touchedConnections = await tx.execute<{ personId: string }>(sql`
    WITH first_msg AS (
      SELECT DISTINCT ON (c.peer_profile_key)
        c.peer_profile_key,
        (m.sender_profile_key IS DISTINCT FROM c.peer_profile_key) AS initiated_by_me
      FROM message m
      JOIN conversation c ON c.id = m.conversation_id
      WHERE m.bd_id = ${bdId} AND m.is_draft = false AND c.peer_profile_key IS NOT NULL
      ORDER BY c.peer_profile_key, m.sent_at ASC
    ),
    peer_agg AS (
      SELECT
        peer_profile_key,
        sum(message_count)::int AS message_count,
        sum(sent_count)::int AS sent_count,
        sum(received_count)::int AS received_count,
        min(first_message_at) AS first_message_at,
        max(last_message_at) AS last_message_at
      FROM conversation
      WHERE bd_id = ${bdId} AND peer_profile_key IS NOT NULL
      GROUP BY peer_profile_key
    )
    UPDATE person_bd_connection pbc
    SET
      message_count = pa.message_count,
      sent_count = pa.sent_count,
      received_count = pa.received_count,
      first_message_at = pa.first_message_at,
      last_message_at = pa.last_message_at,
      initiated_by_me = fm.initiated_by_me,
      reciprocal = (pa.sent_count > 0 AND pa.received_count > 0)
    FROM peer_agg pa
    JOIN contact ct2 ON ct2.bd_id = ${bdId} AND ct2.profile_key = pa.peer_profile_key
    JOIN person_id_map pim ON pim.legacy_table = 'contact' AND pim.legacy_id = ct2.id
    LEFT JOIN first_msg fm ON fm.peer_profile_key = pa.peer_profile_key
    WHERE pbc.person_id = pim.person_id AND pbc.bd_id = ${bdId}
    RETURNING pbc.person_id AS "personId"
  `);

  // Task 5.2 (fresh-review fix): a connection's sent/received counts are
  // stage evidence (design D4), so every person whose connection this
  // import just touched needs its status cache recomputed — batched via
  // recomputePersonStatuses (one bulk read + one bulk UPDATE per chunk,
  // instead of a per-person loop; see src/lib/status/recompute.ts).
  const touchedPersonIds = [...new Set(touchedConnections.map((r) => r.personId))];
  await recomputePersonStatuses(tx, touchedPersonIds);
}

export interface MessageRow {
  id: string;
  senderProfileKey: string | null;
  senderName: string | null;
  sentAt: Date;
  subject: string | null;
  content: string;
}

export interface ConversationThread {
  id: string;
  title: string | null;
  messageCount: number;
  lastMessageAt: Date | null;
  messages: MessageRow[];
}

export interface ConversationThreadsResult {
  threads: ConversationThread[];
  /** True if this peer has more conversations than `conversationLimit`. */
  moreConversations: boolean;
  /** True if the shown conversations have more messages than `messagesLimit` in total. */
  moreMessages: boolean;
}

/**
 * Conversation thread(s) with one peer, most recent conversation first,
 * scoped to the signed-in BD. Message content is sensitive, so both the
 * conversation and message lookups filter on `bdId` — never trust
 * `peerProfileKey` alone.
 *
 * Exactly 2 queries, no N+1 per conversation: the message query fetches the
 * `messagesLimit` most recent (non-draft) messages across all shown
 * conversations in one `IN (...)` lookup, then groups/re-sorts them in JS
 * (oldest -> newest within each thread). Both `conversationLimit` and
 * `messagesLimit` are fetched one row over the cap to detect truncation
 * without an extra count query.
 */
export async function getConversationThreads(
  bdId: string,
  peerProfileKey: string,
  opts: { conversationLimit?: number; messagesLimit?: number } = {},
): Promise<ConversationThreadsResult> {
  const conversationLimit = opts.conversationLimit ?? 3;
  const messagesLimit = opts.messagesLimit ?? 100;

  const conversationRows = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation.messageCount,
      lastMessageAt: conversation.lastMessageAt,
    })
    .from(conversation)
    .where(
      and(eq(conversation.bdId, bdId), eq(conversation.peerProfileKey, peerProfileKey)),
    )
    .orderBy(desc(conversation.lastMessageAt))
    .limit(conversationLimit + 1);

  const moreConversations = conversationRows.length > conversationLimit;
  const conversations = conversationRows.slice(0, conversationLimit);
  if (!conversations.length) {
    return { threads: [], moreConversations: false, moreMessages: false };
  }

  const conversationIds = conversations.map((c) => c.id);
  const messageRows = await db
    .select({
      id: message.id,
      conversationId: message.conversationId,
      senderProfileKey: message.senderProfileKey,
      senderName: message.senderName,
      sentAt: message.sentAt,
      subject: message.subject,
      content: message.content,
    })
    .from(message)
    .where(
      and(
        eq(message.bdId, bdId),
        inArray(message.conversationId, conversationIds),
        eq(message.isDraft, false),
      ),
    )
    .orderBy(desc(message.sentAt))
    .limit(messagesLimit + 1);

  const moreMessages = messageRows.length > messagesLimit;
  const shownMessages = messageRows.slice(0, messagesLimit);

  // Group by conversation, preserving desc order, then reverse per group so
  // each thread reads oldest -> newest.
  const byConversation = new Map<string, MessageRow[]>();
  for (const { conversationId, ...row } of shownMessages) {
    const list = byConversation.get(conversationId) ?? [];
    list.push(row);
    byConversation.set(conversationId, list);
  }
  for (const list of byConversation.values()) list.reverse();

  const threads: ConversationThread[] = conversations.map((c) => ({
    ...c,
    messages: byConversation.get(c.id) ?? [],
  }));

  return { threads, moreConversations, moreMessages };
}
