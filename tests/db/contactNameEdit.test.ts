/**
 * DB-backed test for the first/last name edit on the real write path
 * (`updateContactProperty`): the name lands on `person`, exactly one
 * `person_property_history` row records old value, new value and the actor,
 * and a rejected name writes nothing. Opt-in and fail-closed like the other
 * files here: `npm run test:db` with DATABASE_URL on a local `_e2e` database.
 * Everything runs in one transaction rolled back by a sentinel throw.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

after(async () => {
  const { db } = await import("@/db");
  await db.$client.end();
});

const ROLLBACK = new Error("rollback");
const BD_ID = "00000000-0000-0000-0000-00000000d1d2";

type Tx = Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0];

async function inRolledBackTransaction(body: (tx: Tx) => Promise<void>): Promise<void> {
  const { db } = await import("@/db");
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}

async function seed(tx: Tx, names: { firstName: string | null; lastName: string | null }) {
  const { bd, person } = await import("@/db/schema");
  await tx.insert(bd).values({ id: BD_ID, email: "zz-name-edit@example.test", name: "ZZ Name" });
  const [row] = await tx.insert(person).values(names).returning();
  return row!;
}

async function historyOf(tx: Tx, personId: string) {
  const { personPropertyHistory } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return tx.select().from(personPropertyHistory).where(eq(personPropertyHistory.personId, personId));
}

test("fixing a nameless contact writes the name, the actor and one history row", async () => {
  await inRolledBackTransaction(async (tx) => {
    const row = await seed(tx, { firstName: null, lastName: "Pérez" });
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");

    const updated = await updateContactProperty(row.id, "firstName", "  Ana   María ", BD_ID, { database: tx });
    assert.equal(updated.firstName, "Ana María");
    assert.equal(updated.lastName, "Pérez");
    assert.equal(updated.updatedByBdId, BD_ID);
    const history = await historyOf(tx, row.id);
    assert.equal(history.length, 1);
    assert.equal(history[0]!.property, "firstName");
    assert.equal(history[0]!.oldValue, null);
    assert.equal(history[0]!.newValue, "Ana María");
    assert.equal(history[0]!.changedByBdId, BD_ID);
    assert.equal(history[0]!.source, "edit");
  });
});

test("clearing the last name is stored as null with its history row", async () => {
  await inRolledBackTransaction(async (tx) => {
    const row = await seed(tx, { firstName: "Ana", lastName: "Pérez" });
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");

    const updated = await updateContactProperty(row.id, "lastName", "   ", BD_ID, { database: tx });
    assert.equal(updated.lastName, null);
    const history = await historyOf(tx, row.id);
    assert.deepEqual(history.map((h) => [h.property, h.oldValue, h.newValue]), [["lastName", "Pérez", null]]);
  });
});

test("an emptied first name is refused and nothing is written", async () => {
  await inRolledBackTransaction(async (tx) => {
    const row = await seed(tx, { firstName: "Ana", lastName: "Pérez" });
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
    const { InvalidNameError } = await import("@/lib/contacts/propertyEdit");

    await assert.rejects(updateContactProperty(row.id, "firstName", "  ", BD_ID, { database: tx }), InvalidNameError);
    assert.equal((await historyOf(tx, row.id)).length, 0);
  });
});
