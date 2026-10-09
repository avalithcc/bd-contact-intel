/**
 * Thin DB glue for a single-property inline edit on `company` (company-fields
 * change). Mirrors src/lib/contacts/propertyEditDb.ts: imports `db`
 * (side-effecting, requires DATABASE_URL), so this file is not unit-tested
 * directly — planCompanyPropertyEdit (propertyEdit.ts) carries the tested
 * logic. Reads the current row (and, for `ownerBdId`, checks the incoming id
 * against `bd`) and writes the update plus the company_property_history row
 * in ONE transaction so they can never diverge.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { bd, company, companyPropertyHistory, type Company } from "@/db/schema";
import {
  DomainInUseError,
  isDomainIndexViolation,
  planCompanyPropertyEdit,
  type EditableCompanyProperty,
} from "@/lib/companies/propertyEdit";
import { CompanyNotFoundError } from "@/lib/companies/errors";

export async function updateCompanyProperty(
  companyKey: string,
  property: EditableCompanyProperty,
  rawNewValue: string,
  changedByBdId: string,
): Promise<Company> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(company).where(eq(company.companyKey, companyKey));
    if (!row) throw new CompanyNotFoundError(companyKey);

    let ownerExists: boolean | undefined;
    if (property === "ownerBdId") {
      const trimmed = rawNewValue.trim();
      if (trimmed) {
        const [bdRow] = await tx.select({ id: bd.id }).from(bd).where(eq(bd.id, trimmed));
        ownerExists = !!bdRow;
      }
    }

    const plan = planCompanyPropertyEdit(row, property, rawNewValue, changedByBdId, { ownerExists });
    if (!plan.changed) return row;

    // Another company holding the domain is a user-correctable failure, not
    // a raw constraint error. The index still guards the race between this
    // read and the write, mapped below.
    const newDomain = property === "domain" ? (plan.companyUpdate!.domain ?? null) : null;
    if (newDomain) {
      const [holder] = await tx
        .select({ companyKey: company.companyKey })
        .from(company)
        .where(and(eq(company.domain, newDomain), ne(company.companyKey, companyKey)))
        .limit(1);
      if (holder) throw new DomainInUseError(newDomain);
    }

    let updated: Company | undefined;
    try {
      [updated] = await tx.update(company).set(plan.companyUpdate!).where(eq(company.companyKey, companyKey)).returning();
    } catch (err) {
      if (newDomain && isDomainIndexViolation(err)) throw new DomainInUseError(newDomain);
      throw err;
    }
    if (plan.historyRows.length) {
      await tx.insert(companyPropertyHistory).values(plan.historyRows);
    }
    return updated!;
  });
}
