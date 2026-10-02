import { eq, type SQL } from "drizzle-orm";
import { company } from "@/db/schema";
import { accountTypeCondition, type AccountType } from "@/lib/companies/accountTypeFilter";
import { clientStatusCondition } from "@/lib/companies/clientStatusFilter";
import { companySearchCondition } from "@/lib/companies/searchCondition";
import type { ClientStatus } from "@/lib/companies/clientStatus";

export interface CompanyListFilters {
  view: "all" | "mine" | "hiring";
  meBdId: string;
  stage?: string;
  industry?: string;
  owner?: string;
  accountType?: AccountType;
  clientStatus?: ClientStatus;
  q?: string;
}

/**
 * Every WHERE condition of the `/companies` list except the hiring-view key
 * list, which needs the hiring index. Pure and db-free (listQueries.ts imports
 * `db`, which throws at import without `DATABASE_URL`), so the filters'
 * composition is unit-testable. All conditions are ANDed by the caller: each
 * filter narrows, none replaces another.
 */
export function companyListConditions(f: CompanyListFilters): SQL[] {
  const conditions: SQL[] = [];
  if (f.stage) conditions.push(eq(company.relationshipStage, f.stage));
  if (f.view === "mine") conditions.push(eq(company.ownerBdId, f.meBdId));
  if (f.industry) conditions.push(eq(company.industry, f.industry));
  if (f.owner) conditions.push(eq(company.ownerBdId, f.owner));
  const accountTypeWhere = accountTypeCondition(f.accountType);
  if (accountTypeWhere) conditions.push(accountTypeWhere);
  const clientStatusWhere = clientStatusCondition(f.clientStatus);
  if (clientStatusWhere) conditions.push(clientStatusWhere);
  const searchWhere = companySearchCondition(f.q);
  if (searchWhere) conditions.push(searchWhere);
  return conditions;
}
