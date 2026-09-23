import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { company, type Company, type NewCompany } from "@/db/schema";

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
    .select()
    .from(company)
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

export async function getCompanyByKey(companyKey: string): Promise<Company | null> {
  const [row] = await db.select().from(company).where(eq(company.companyKey, companyKey));
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
