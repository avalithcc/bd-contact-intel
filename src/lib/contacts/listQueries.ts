/**
 * Read side of the `/contacts` list (task 12.2-12.4; contact-list spec
 * "Central list, no per-BD scoping"). Not `bdId`-scoped — filters (owner,
 * status, hiring, email verified) apply on top of the whole shared
 * `person` table, same convention as contacts/queries.ts#getContactRecord.
 *
 * Server-side pagination and filtering in SQL (proposal: ~20k persons,
 * never load all rows) using the existing `person` indexes (owner, status,
 * company_key). `count(*)::int` casts the aggregate — Postgres returns
 * bigint aggregates as strings over the wire otherwise.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bd, person } from "@/db/schema";
import { getHiringCompanyKeys } from "@/lib/hiring/queries";
import type { ContactFilters } from "@/lib/contacts/viewFilters";

const LIKE_WILDCARD_RE = /[%_\\]/g;
function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

const MAX_SEARCH_TOKENS = 5;

function searchCondition(q: string) {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
  if (!tokens.length) return undefined;
  const tokenConditions = tokens.map((token) => {
    const pattern = `%${escapeLikeWildcards(token)}%`;
    return or(
      ilike(person.firstName, pattern),
      ilike(person.lastName, pattern),
      ilike(person.company, pattern),
      ilike(person.email, pattern),
    );
  });
  return and(...tokenConditions);
}

export interface ContactListRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  ownerBdId: string | null;
  ownerName: string | null;
  status: string;
  email: string | null;
  emailStatus: string;
  // Column-picker (task 13.1) additions — projected always, rendered only
  // when the resolved column set includes them (src/lib/contacts/columns.ts).
  roleGroup: string | null;
  industry: string | null;
  country: string | null;
  sourceKey: string | null;
  createdAt: Date;
}

export interface ContactListPage {
  rows: ContactListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * `meBdId` resolves the `owner: "me"` filter (contact-list spec: "My new
 * contacts" reproduced as a saved view). Rows with `merged_into_id` set are
 * always excluded — those are hidden from every read (design D1/D6).
 */
export async function getContactListPage(
  filters: ContactFilters,
  meBdId: string,
  q: string | undefined,
  page: number,
  pageSize: number,
  hiringKeys?: Set<string>,
): Promise<ContactListPage> {
  const where = [sql`${person.mergedIntoId} is null`];

  if (filters.owner === "me") where.push(eq(person.ownerBdId, meBdId));
  if (filters.status?.length) where.push(inArray(person.status, filters.status));
  if (filters.emailVerified) where.push(eq(person.emailStatus, "verified"));
  if (filters.hiring) {
    const keys = hiringKeys ?? (await getHiringCompanyKeys());
    where.push(keys.size ? inArray(person.companyKey, [...keys]) : sql`false`);
  }
  if (q) {
    const condition = searchCondition(q);
    if (condition) where.push(condition);
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(person)
    .where(and(...where));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const rows = await db
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      jobTitle: person.jobTitle,
      company: person.company,
      ownerBdId: person.ownerBdId,
      ownerName: bd.name,
      status: person.status,
      email: person.email,
      emailStatus: person.emailStatus,
      roleGroup: person.roleGroup,
      industry: person.industry,
      country: person.country,
      sourceKey: person.sourceKey,
      createdAt: person.createdAt,
    })
    .from(person)
    .leftJoin(bd, eq(bd.id, person.ownerBdId))
    .where(and(...where))
    .orderBy(asc(person.lastName), asc(person.firstName))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return { rows, total, page: safePage, pageSize, totalPages };
}

/**
 * Fetches the same row shape as getContactListPage, but for an explicit set
 * of ids (bulk "Exportar", task 13.2) instead of a filtered/paginated view —
 * the export always reflects exactly the rows the BD checked, not the
 * active view's filters. Excludes merged-away rows (design D1/D6), same as
 * every other read. No `total`/pagination — ids.length IS the row count,
 * already capped by sanitizeBulkPersonIds (MAX_BULK_SELECTION) upstream.
 */
export async function getContactListRowsByIds(ids: string[]): Promise<ContactListRow[]> {
  if (!ids.length) return [];
  return db
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      jobTitle: person.jobTitle,
      company: person.company,
      ownerBdId: person.ownerBdId,
      ownerName: bd.name,
      status: person.status,
      email: person.email,
      emailStatus: person.emailStatus,
      roleGroup: person.roleGroup,
      industry: person.industry,
      country: person.country,
      sourceKey: person.sourceKey,
      createdAt: person.createdAt,
    })
    .from(person)
    .leftJoin(bd, eq(bd.id, person.ownerBdId))
    .where(and(sql`${person.mergedIntoId} is null`, inArray(person.id, ids)));
}

/**
 * Per-view result counts for the tab badges (mockup: "Todos los
 * contactos<span class='count'>16,642</span>"). One count query per system
 * view — small, fixed number of views, each hitting an indexed column.
 */
export async function getContactCountForFilters(
  filters: ContactFilters,
  meBdId: string,
  hiringKeys?: Set<string>,
): Promise<number> {
  const where = [sql`${person.mergedIntoId} is null`];
  if (filters.owner === "me") where.push(eq(person.ownerBdId, meBdId));
  if (filters.status?.length) where.push(inArray(person.status, filters.status));
  if (filters.emailVerified) where.push(eq(person.emailStatus, "verified"));
  if (filters.hiring) {
    const keys = hiringKeys ?? (await getHiringCompanyKeys());
    where.push(keys.size ? inArray(person.companyKey, [...keys]) : sql`false`);
  }
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(person)
    .where(and(...where));
  return total;
}
