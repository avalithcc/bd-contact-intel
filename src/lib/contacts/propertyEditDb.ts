/**
 * Thin DB glue for a single-property inline edit (task 9.4; contact-record
 * spec "editable properties"). Imports `db` (side-effecting, requires
 * DATABASE_URL) so — same convention as src/lib/identity/resolveDb.ts — this
 * file is not unit-tested directly; planPropertyEdit (propertyEdit.ts)
 * carries the tested logic. Reads the current row and writes the update plus
 * the person_property_history row in ONE transaction so they can never
 * diverge (contact-identity R7).
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { person, personPropertyHistory, type Person } from "@/db/schema";
import {
  planPropertyEdit,
  planLocationEdit,
  type EditablePersonProperty,
  type LocationEditFields,
} from "@/lib/contacts/propertyEdit";
import { assertContactEditable } from "@/lib/contacts/mergeGuard";
import { normalizePhoneForWrite } from "@/lib/phoneNormalize";
import {
  ContactNotFoundError,
  ProfileKeyTakenError,
  isProfileKeyUniqueViolation,
  type ProfileKeyOwner,
} from "@/lib/contacts/errors";
import { normalizeLinkedinProfileKey } from "@/lib/contacts/linkedinProfile";

/** `deps.database` exists for tests/db (a rolled-back transaction); production passes nothing. */
export interface PropertyEditDeps {
  database?: Pick<typeof db, "transaction" | "select">;
}

type Reader = Pick<typeof db, "select">;
const MAX_SURVIVOR_HOPS = 5;

function displayName(r: { firstName: string | null; lastName: string | null; email: string | null }, fallback: string): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || fallback;
}

/** Follows `merged_into_id` to the live contact (bounded; error path only). */
async function findSurvivor(conn: Reader, startId: string): Promise<{ id: string; name: string } | null> {
  let last: { id: string; name: string } | null = null;
  let currentId: string | null = startId;
  for (let hop = 0; currentId && hop < MAX_SURVIVOR_HOPS; hop++) {
    const [r] = await conn
      .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, email: person.email, mergedIntoId: person.mergedIntoId })
      .from(person)
      .where(eq(person.id, currentId))
      .limit(1);
    if (!r) break;
    last = { id: r.id, name: displayName(r, r.id) };
    currentId = r.mergedIntoId;
  }
  return last;
}

/**
 * Another contact holding `key`, as the link target for the collision error.
 * A holder that was already merged away still blocks the key (the unique
 * constraint has no WHERE), so it is reported with its survivor.
 */
async function findProfileKeyOwner(conn: Reader, key: string, exceptPersonId: string): Promise<ProfileKeyOwner | null> {
  const [other] = await conn
    .select({ id: person.id, firstName: person.firstName, lastName: person.lastName, email: person.email, mergedIntoId: person.mergedIntoId })
    .from(person)
    .where(and(eq(person.profileKey, key), ne(person.id, exceptPersonId)))
    .limit(1);
  if (!other) return null;
  const owner: ProfileKeyOwner = { id: other.id, name: displayName(other, key) };
  const survivor = other.mergedIntoId ? await findSurvivor(conn, other.mergedIntoId) : null;
  return survivor ? { ...owner, mergedInto: survivor } : owner;
}

export async function updateContactProperty(
  personId: string,
  property: EditablePersonProperty,
  rawNewValue: string,
  changedByBdId: string,
  deps: PropertyEditDeps = {},
): Promise<Person> {
  const { database = db } = deps;
  try {
    return await writeContactProperty(database, personId, property, rawNewValue, changedByBdId);
  } catch (err) {
    // Race: another write took the key between our pre-check and the update.
    // The failed statement aborted the transaction, so the owner is looked up
    // on a fresh connection.
    if (property === "profileKey" && isProfileKeyUniqueViolation(err)) {
      const key = normalizeLinkedinProfileKey(rawNewValue);
      const owner = key.ok ? await findProfileKeyOwner(database, key.value, personId) : null;
      if (owner) throw new ProfileKeyTakenError(owner);
    }
    throw err;
  }
}

async function writeContactProperty(
  database: NonNullable<PropertyEditDeps["database"]>,
  personId: string,
  property: EditablePersonProperty,
  rawNewValue: string,
  changedByBdId: string,
): Promise<Person> {
  return database.transaction(async (tx) => {
    const [row] = await tx.select().from(person).where(eq(person.id, personId));
    if (!row) throw new ContactNotFoundError(personId);
    assertContactEditable(row);

    const plan = planPropertyEdit(row, property, rawNewValue, changedByBdId, normalizePhoneForWrite);
    if (!plan.changed) return row;

    const newKey = property === "profileKey" ? (plan.personUpdate?.profileKey ?? null) : null;
    if (newKey) {
      const owner = await findProfileKeyOwner(tx, newKey, personId);
      if (owner) throw new ProfileKeyTakenError(owner);
    }

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
