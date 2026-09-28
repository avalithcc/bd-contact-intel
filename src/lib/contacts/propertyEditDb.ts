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
  planLocationEdit,
  type EditablePersonProperty,
  type LocationEditFields,
} from "@/lib/contacts/propertyEdit";
import { assertContactEditable } from "@/lib/contacts/mergeGuard";
import { ContactNotFoundError } from "@/lib/contacts/errors";

export async function updateContactProperty(
  personId: string,
  property: EditablePersonProperty,
  rawNewValue: string,
  changedByBdId: string,
): Promise<Person> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(person).where(eq(person.id, personId));
    if (!row) throw new ContactNotFoundError(personId);
    assertContactEditable(row);

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

/**
 * Atomic counterpart to `updateContactProperty` for the "Ubicación"
 * composite row (fresh-review CRITICAL fix — see `planLocationEdit`'s doc
 * comment). Reads the row once, plans all three fields together, and — if
 * any field's plan is accepted — writes ONE `person` update plus every
 * changed field's `person_property_history` row inside the SAME
 * transaction. A field rejected by `planLocationEdit` throws
 * `PropertyBatchEditError` before this function ever calls `tx.update`, so
 * postgres never sees a partial write to roll back in the first place —
 * the transaction is a defense-in-depth belt for db-level failures, not the
 * only thing standing between "one field rejected" and "some fields
 * persisted".
 */
export async function updateContactProperties(
  personId: string,
  fields: LocationEditFields,
  changedByBdId: string,
): Promise<Person> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(person).where(eq(person.id, personId));
    if (!row) throw new ContactNotFoundError(personId);
    assertContactEditable(row);

    const plan = planLocationEdit(row, fields, changedByBdId);
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
