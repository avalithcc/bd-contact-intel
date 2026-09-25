/**
 * Thin DB glue for a single-property inline edit (task 9.4; contact-record
 * spec "editable properties"). Imports `db` (side-effecting, requires
 * DATABASE_URL) so — same convention as src/lib/identity/resolveDb.ts — this
 * file is not unit-tested directly; planPropertyEdit (propertyEdit.ts)
 * carries the tested logic. Reads the current row and writes the update plus
 * the person_property_history row in ONE transaction so they can never
 * diverge (contact-identity R7).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { person, personPropertyHistory, type Person } from "@/db/schema";
import {
  planPropertyEdit,
  type EditablePersonProperty,
} from "@/lib/contacts/propertyEdit";

export async function updateContactProperty(
  personId: string,
  property: EditablePersonProperty,
  rawNewValue: string,
  changedByBdId: string,
): Promise<Person> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(person).where(eq(person.id, personId));
    if (!row) throw new Error(`Contact not found: ${personId}`);

    const plan = planPropertyEdit(row, property, rawNewValue, changedByBdId);
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
