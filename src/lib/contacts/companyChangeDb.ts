/**
 * Thin DB glue for the "Cambiar empresa" dialog (companyChange.ts carries
 * the tested planning logic). Imports `db` (side-effecting, requires
 * DATABASE_URL), same convention as propertyEditDb.ts. Reads the current
 * person row and — when attaching, not detaching — the picked company row
 * by its `companyKey`, so the write can NEVER be spoofed with a display
 * name for a company that doesn't exist (the dialog's search only ever
 * offers companies already on file; this is the server-side half of that
 * guarantee). Writes the person update plus the person_property_history
 * rows in ONE transaction so they can never diverge (contact-identity R7).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { company, person, personPropertyHistory, type Person } from "@/db/schema";
import { planCompanyChange } from "@/lib/contacts/companyChange";
import { assertContactEditable } from "@/lib/contacts/mergeGuard";
import { ContactNotFoundError } from "@/lib/contacts/errors";
import { CompanyNotFoundError } from "@/lib/companies/errors";

/**
 * `companyKey` is the company picked in the dialog, or `null` to detach
 * (clear the contact's company — the record page allows this so a
 * miskeyed contact can be pulled off a wrong company without being forced
 * to pick a replacement in the same step).
 */
export async function changeContactCompany(
  personId: string,
  companyKey: string | null,
  changedByBdId: string,
): Promise<Person> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(person).where(eq(person.id, personId));
    if (!row) throw new ContactNotFoundError(personId);
    assertContactEditable(row);

    let newCompany: { companyKey: string; displayName: string } | null = null;
    if (companyKey !== null) {
      const [companyRow] = await tx
        .select({ companyKey: company.companyKey, displayName: company.displayName })
        .from(company)
        .where(eq(company.companyKey, companyKey));
      if (!companyRow) throw new CompanyNotFoundError(companyKey);
      newCompany = companyRow;
    }

    const plan = planCompanyChange(row, newCompany, changedByBdId);
    if (!plan.changed) return row;

    const [updated] = await tx
      .update(person)
      .set(plan.personUpdate!)
      .where(eq(person.id, personId))
      .returning();
    if (plan.historyRows.length) {
      await tx.insert(personPropertyHistory).values(plan.historyRows);
    }
    return updated!;
  });
}
