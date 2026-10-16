/**
 * DB-backed test: a Cargo edit through the real write path
 * (`updateContactProperty`) re-derives `person.role_group` and lands the
 * jobTitle AND roleGroup `person_property_history` rows in the same
 * transaction. Opt-in and fail-closed like the other files here:
 * `npm run test:db`, DATABASE_URL pointing at a local `_e2e` database.
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
const BD_ID = "00000000-0000-0000-0000-00000000d2d2";

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

async function seed(tx: Tx, jobTitle: string, roleGroup: string | null) {
  const { bd, person } = await import("@/db/schema");
  await tx.insert(bd).values({ id: BD_ID, email: "zz-role-group-edit@example.test", name: "ZZ" });
  const [row] = await tx.insert(person).values({ firstName: "Rita", lastName: "Role", jobTitle, roleGroup }).returning();
  return row!;
}

async function readBack(tx: Tx, personId: string) {
  const { person, personPropertyHistory } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await tx.select().from(person).where(eq(person.id, personId));
  const history = await tx.select().from(personPropertyHistory).where(eq(personPropertyHistory.personId, personId));
  return { row: row!, history };
}

test("a Cargo edit re-derives role_group and writes both history rows", async () => {
  await inRolledBackTransaction(async (tx) => {
    const p = await seed(tx, "Engineer", "developers");
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
    await updateContactProperty(p.id, "jobTitle", "Head of Engineering", BD_ID, { database: tx });

    const { row, history } = await readBack(tx, p.id);
    assert.equal(row.jobTitle, "Head of Engineering");
    assert.equal(row.roleGroup, "eng_leadership");
    const byProp = new Map(history.map((h) => [h.property, h]));
    assert.equal(history.length, 2);
    assert.deepEqual(
      [byProp.get("jobTitle")?.oldValue, byProp.get("jobTitle")?.newValue, byProp.get("jobTitle")?.changedByBdId],
      ["Engineer", "Head of Engineering", BD_ID],
    );
    assert.deepEqual(
      [byProp.get("roleGroup")?.oldValue, byProp.get("roleGroup")?.newValue, byProp.get("roleGroup")?.changedByBdId],
      ["developers", "eng_leadership", BD_ID],
    );
  });
});

test("saving an unchanged Cargo repairs a stale role_group with a single roleGroup history row", async () => {
  await inRolledBackTransaction(async (tx) => {
    const p = await seed(tx, "Head of Engineering", "developers");
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
    await updateContactProperty(p.id, "jobTitle", "Head of Engineering", BD_ID, { database: tx });

    const { row, history } = await readBack(tx, p.id);
    assert.equal(row.roleGroup, "eng_leadership");
    assert.deepEqual(history.map((h) => h.property), ["roleGroup"]);
  });
});

test("an edit that keeps the derived group writes only the jobTitle row", async () => {
  await inRolledBackTransaction(async (tx) => {
    const p = await seed(tx, "Engineer", "developers");
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
    await updateContactProperty(p.id, "jobTitle", "Software Engineer", BD_ID, { database: tx });

    const { row, history } = await readBack(tx, p.id);
    assert.equal(row.roleGroup, "developers");
    assert.deepEqual(history.map((h) => h.property), ["jobTitle"]);
  });
});
