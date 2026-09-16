import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, companyAlias, companyCategory, contact, type NewContact } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { classifyPosition, type RoleGroupKey } from "@/lib/roleGroups";
import {
  normalizeCompanyKey,
  type CompanyCategoryKey,
} from "@/lib/companyCategories";
import { bucketTopN } from "@/lib/bucketing";

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
  const [created] = await db
    .insert(bd)
    .values({ name: user.email.split("@")[0], email: user.email })
    .returning();
  return created;
}

export interface ContactFilters {
  company?: string;
  position?: string;
  roleGroup?: RoleGroupKey;
  companyCategory?: CompanyCategoryKey;
  // Exact match on the normalized company key (see
  // src/lib/companyCategories.ts#normalizeCompanyKey), used by the /hiring
  // "N contacts" link to jump straight to a specific company's contacts
  // rather than relying on free-text `company` matching.
  companyKey?: string;
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
function companyKeyFilter(key: string) {
  const canonicalKey = sql`coalesce((select ${companyAlias.companyKey} from ${companyAlias} where ${companyAlias.aliasKey} = ${key}), ${key})`;
  return sql`${contact.companyKey} in (
    select ${companyAlias.aliasKey} from ${companyAlias} where ${companyAlias.companyKey} = (${canonicalKey})
    union
    select (${canonicalKey})
  )`;
}

export async function listContacts(
  bdId: string,
  filters: ContactFilters = {},
  page = 1,
  pageSize = 20,
): Promise<ContactsPage> {
  const where = [eq(contact.bdId, bdId)];
  if (filters.company) where.push(ilike(contact.company, `%${filters.company}%`));
  if (filters.position)
    where.push(ilike(contact.position, `%${filters.position}%`));
  if (filters.roleGroup) where.push(eq(contact.roleGroup, filters.roleGroup));
  if (filters.companyCategory)
    where.push(eq(contact.companyCategory, filters.companyCategory));
  if (filters.companyKey) where.push(companyKeyFilter(filters.companyKey));

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
    rows: rows.map((r) => ({ ...r, overlapWith: overlap.get(r.profileKey) ?? [] })),
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
  email: string | null;
  industry: string | null;
  connectedOn: string | null;
  profileKey: string;
  createdAt: Date;
  overlapWith: string[];
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
    email: row.email,
    industry: row.industry,
    connectedOn: row.connectedOn,
    profileKey: row.profileKey,
    createdAt: row.createdAt,
    overlapWith: overlap.get(row.profileKey) ?? [],
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

/** Upsert a batch of parsed connections into a BD's private base. */
export async function upsertContacts(
  bdId: string,
  rows: Omit<NewContact, "bdId">[],
): Promise<number> {
  if (!rows.length) return 0;
  let count = 0;
  // chunk to keep parameter counts sane
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const rowsChunk = rows.slice(i, i + chunkSize);
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
    await db
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
    count += chunk.length;
  }
  return count;
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
