import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { bd, company, type Company, type NewCompany } from "@/db/schema";

const owner = alias(bd, "owner");

const MAX_SEARCH_TOKENS = 5;

const LIKE_WILDCARD_RE = /[%_\\]/g;
function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

export interface CompanyFilters {
  search?: string;
  relationshipStage?: string;
}

export interface CompanyRow {
  companyKey: string;
  displayName: string;
  relationshipStage: string | null;
  revenuePotential: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  // company-fields change (owner-approved 2026-09-26): HubSpot-style fields.
  industry: string | null;
  ownerBdId: string | null;
  // Bounded join against `bd` (one row per company, joined once here, never
  // per-row in a loop) — the list filter needs the owner's name, not just
  // the id.
  ownerName: string | null;
  city: string | null;
  country: string | null;
}

export interface CompaniesPage {
  rows: CompanyRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function searchCondition(q: string): SQL | undefined {
  const tokens = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TOKENS);
  if (!tokens.length) return undefined;

  const tokenConditions = tokens.map((token) => {
    const pattern = `%${escapeLikeWildcards(token)}%`;
    return ilike(company.displayName, pattern);
  });

  return or(...tokenConditions);
}

export async function getCompanies(
  filters: CompanyFilters,
  page: number = 1,
  pageSize: number = 50,
): Promise<CompaniesPage> {
  const conditions: SQL[] = [];

  if (filters.search) {
    const search = searchCondition(filters.search);
    if (search) conditions.push(search);
  }

  if (filters.relationshipStage) {
    conditions.push(eq(company.relationshipStage, filters.relationshipStage));
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(company)
    .where(whereCondition);

  const offset = (page - 1) * pageSize;
  const rows = await db
    .select({
      companyKey: company.companyKey,
      displayName: company.displayName,
      relationshipStage: company.relationshipStage,
      revenuePotential: company.revenuePotential,
      notes: company.notes,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      industry: company.industry,
      ownerBdId: company.ownerBdId,
      ownerName: owner.name,
      city: company.city,
      country: company.country,
    })
    .from(company)
    .leftJoin(owner, eq(company.ownerBdId, owner.id))
    .where(whereCondition)
    .orderBy(company.displayName)
    .limit(pageSize)
    .offset(offset);

  return {
    rows,
    total: total?.count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((total?.count ?? 0) / pageSize),
  };
}

/**
 * "N contactos en esta empresa" (mockup-port r05; contact-record.html:163).
 * Bounded to one company — excludes merged-away rows (design D6), same
 * convention as every other Contact read (queries.ts's `findPersonById`).
 */
export async function getCompanyContactCount(companyKey: string): Promise<number> {
  const [row] = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from person where company_key = ${companyKey} and merged_into_id is null`,
  );
  return row ? Number(row.count) : 0;
}

export type CompanyWithOwner = Company & { ownerName: string | null };

export async function getCompanyByKey(companyKey: string): Promise<CompanyWithOwner | null> {
  const [row] = await db
    .select({
      companyKey: company.companyKey,
      displayName: company.displayName,
      relationshipStage: company.relationshipStage,
      revenuePotential: company.revenuePotential,
      notes: company.notes,
      createdByBdId: company.createdByBdId,
      updatedByBdId: company.updatedByBdId,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      domain: company.domain,
      industry: company.industry,
      ownerBdId: company.ownerBdId,
      ownerName: owner.name,
      city: company.city,
      country: company.country,
      accountType: company.accountType,
      clientStatus: company.clientStatus,
      linkedinUrl: company.linkedinUrl,
    })
    .from(company)
    .leftJoin(owner, eq(company.ownerBdId, owner.id))
    .where(eq(company.companyKey, companyKey));
  return row ?? null;
}

export async function createCompany(input: NewCompany): Promise<Company> {
  const [row] = await db.insert(company).values(input).returning();
  return row!;
}

export async function updateCompany(
  companyKey: string,
  updates: Partial<NewCompany>,
): Promise<Company> {
  const [row] = await db
    .update(company)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(company.companyKey, companyKey))
    .returning();
  return row!;
}

export async function deleteCompany(companyKey: string): Promise<void> {
  await db.delete(company).where(eq(company.companyKey, companyKey));
}
