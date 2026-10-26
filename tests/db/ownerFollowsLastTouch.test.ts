/**
 * "The BD who contacts is the new owner", against a scratch database, through the PRODUCTION activity writers
 * (createActivityInTx, registerContactMeeting), never a hand-written activity insert for the touch itself.
 * A touch by B moves a contact owned by A and writes an `owner_touch` history row; a touch by the owner is a no-op;
 * a manually assigned owner (history source `edit`) never moves; a no-progress activity never moves it.
 * Opt-in and fail-closed: `npm run test:db`, DATABASE_URL a local `_e2e` database. Each test rolls back.
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

/** A owns the contact and worked it in the past; B is another BD. */
async function seed(tx: Tx) {
  const { activity, bd, person } = await import("@/db/schema");
  const [a] = await tx.insert(bd).values({ email: "zz-ot-a@example.test", name: "ZZ Owner A" }).returning();
  const [b] = await tx.insert(bd).values({ email: "zz-ot-b@example.test", name: "ZZ Toucher B" }).returning();
  const [contact] = await tx.insert(person).values({ firstName: "Marta", lastName: "Prueba", ownerBdId: a!.id }).returning();
  await tx.insert(activity).values({ personId: contact!.id, actorBdId: a!.id, type: "note", metadata: { body: "first contact" }, createdAt: new Date("2026-09-01T12:00:00Z") });
  return { a: a!, b: b!, contact: contact! };
}

async function ownerOf(tx: Tx, personId: string) {
  const { eq } = await import("drizzle-orm");
  const { person } = await import("@/db/schema");
  const [row] = await tx.select({ ownerBdId: person.ownerBdId }).from(person).where(eq(person.id, personId));
  return row!.ownerBdId;
}

async function ownerHistory(tx: Tx, personId: string) {
  const { eq } = await import("drizzle-orm");
  const { personPropertyHistory } = await import("@/db/schema");
  return tx.select().from(personPropertyHistory).where(eq(personPropertyHistory.personId, personId));
}

async function touch(tx: Tx, personId: string, bdId: string, type: string) {
  const { createActivityInTx } = await import("@/lib/activity/queries");
  await createActivityInTx(tx, { personId, actorBdId: bdId, type, metadata: { body: "x" } } as never);
}

test("a note by B on a contact owned by A moves it to B and writes an owner_touch history row (never edit)", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { a, b, contact } = await seed(tx);
    await touch(tx, contact.id, b.id, "note");
    assert.equal(await ownerOf(tx, contact.id), b.id);
    const history = await ownerHistory(tx, contact.id);
    assert.equal(history.length, 1);
    assert.equal(history[0]!.source, "owner_touch");
    assert.equal(history[0]!.property, "ownerBdId");
    assert.equal(history[0]!.oldValue, a.id);
    assert.equal(history[0]!.newValue, b.id);
    assert.equal(history[0]!.changedByBdId, b.id);
  });
});

test("a held meeting registered by B moves the contact; a merely scheduled one does not", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { registerContactMeeting } = await import("@/lib/meetings/db");
    const { a, b, contact } = await seed(tx);
    const now = new Date("2026-10-22T15:00:00.000Z");
    const scheduled = await registerContactMeeting(contact.id, b.id, "2026-10-30", "11:00", "Demo", now, { database: tx });
    assert.equal(scheduled.kind, "scheduled");
    assert.equal(await ownerOf(tx, contact.id), a.id);
    const held = await registerContactMeeting(contact.id, b.id, "2026-10-21", "11:00", "Demo", now, { database: tx });
    assert.equal(held.kind, "held");
    assert.equal(await ownerOf(tx, contact.id), b.id);
  });
});

test("a touch by the current owner is a no-op: no owner change and no history row", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { a, contact } = await seed(tx);
    await touch(tx, contact.id, a.id, "note");
    assert.equal(await ownerOf(tx, contact.id), a.id);
    assert.equal((await ownerHistory(tx, contact.id)).length, 0);
  });
});

test("a second touch by the new owner writes nothing more", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { b, contact } = await seed(tx);
    await touch(tx, contact.id, b.id, "note");
    await touch(tx, contact.id, b.id, "note");
    assert.equal((await ownerHistory(tx, contact.id)).length, 1);
  });
});

for (const property of ["ownerBdId", "owner_bd_id"]) {
  test(`a manual owner (history source edit, property ${property}) never moves, whoever touches the contact`, async () => {
    await inRolledBackTransaction(async (tx) => {
      const { personPropertyHistory } = await import("@/db/schema");
      const { a, b, contact } = await seed(tx);
      await tx.insert(personPropertyHistory).values({ personId: contact.id, property, oldValue: null, newValue: a.id, changedByBdId: a.id, source: "edit" });
      await touch(tx, contact.id, b.id, "note");
      await touch(tx, contact.id, b.id, "email_sent");
      assert.equal(await ownerOf(tx, contact.id), a.id);
      assert.equal((await ownerHistory(tx, contact.id)).length, 1, "only the manual row, nothing written by the touch");
    });
  });
}

test("the hook called straight on a manual-owner contact with a newer touch by B moves nothing and returns 0", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { activity, personPropertyHistory } = await import("@/db/schema");
    const { transferOwnersOnTouch } = await import("@/lib/identity/ownerOnTouchDb");
    const { a, b, contact } = await seed(tx);
    await tx.insert(personPropertyHistory).values({ personId: contact.id, property: "ownerBdId", oldValue: null, newValue: a.id, changedByBdId: a.id, source: "edit" });
    await tx.insert(activity).values({ personId: contact.id, actorBdId: b.id, type: "note", metadata: { body: "x" } });
    assert.equal(await transferOwnersOnTouch(tx, [contact.id], b.id), 0);
    assert.equal(await ownerOf(tx, contact.id), a.id);
  });
});

for (const type of ["lusha_reveal", "call_attempt", "auto_reply_received", "email_bounced"]) {
  test(`a ${type} by B never moves the owner, neither through the writer nor when the hook reads the activity itself`, async () => {
    await inRolledBackTransaction(async (tx) => {
      const { transferOwnersOnTouch } = await import("@/lib/identity/ownerOnTouchDb");
      const { a, b, contact } = await seed(tx);
      await touch(tx, contact.id, b.id, type); // production writer
      assert.equal(await transferOwnersOnTouch(tx, [contact.id], b.id), 0); // the SQL read is the authority, not the writer's type filter
      assert.equal(await ownerOf(tx, contact.id), a.id);
      assert.equal((await ownerHistory(tx, contact.id)).length, 0);
    });
  });
}
