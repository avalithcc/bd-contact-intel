/**
 * DB-backed test for the LinkedIn profile edit on the real write path
 * (`updateContactProperty`) against `person_profile_key_unique`.
 *  - a key held by another contact is refused as `ProfileKeyTakenError` naming
 *    that contact, and NOTHING is written to the editing contact;
 *  - a key held by a contact already merged away is reported with its survivor
 *    (the constraint has no WHERE, so it still blocks);
 *  - the raw driver error is what `isProfileKeyUniqueViolation` recognises, so
 *    the race path cannot silently degrade into a generic 500.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, with
 * DATABASE_URL pointing at a local database whose name ends in `_e2e`.
 * Everything runs in one transaction rolled back by a sentinel throw; the
 * write under test nests as a savepoint.
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
const BD_ID = "00000000-0000-0000-0000-00000000d1d1";
const KEY = "linkedin.com/in/zz-profile-edit-taken";

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

async function seedPeople(tx: Tx, holder: { mergedInto?: boolean } = {}) {
  const { bd, person } = await import("@/db/schema");
  await tx.insert(bd).values({ id: BD_ID, email: "zz-profile-edit@example.test", name: "ZZ" });
  const [survivor] = await tx.insert(person).values({ firstName: "Sol", lastName: "Survivor" }).returning();
  const [holderRow] = await tx
    .insert(person)
    .values({ firstName: "Hugo", lastName: "Holder", profileKey: KEY, ...(holder.mergedInto ? { mergedIntoId: survivor!.id } : {}) })
    .returning();
  const [editor] = await tx.insert(person).values({ firstName: "Eva", lastName: "Editor" }).returning();
  return { survivor: survivor!, holder: holderRow!, editor: editor! };
}

async function assertNothingWritten(tx: Tx, editorId: string) {
  const { person, personPropertyHistory } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await tx.select({ profileKey: person.profileKey }).from(person).where(eq(person.id, editorId));
  assert.equal(row?.profileKey, null);
  const history = await tx.select().from(personPropertyHistory).where(eq(personPropertyHistory.personId, editorId));
  assert.equal(history.length, 0);
}

test("a key held by another contact is refused naming that contact, nothing written", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { holder, editor } = await seedPeople(tx);
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
    const { ProfileKeyTakenError } = await import("@/lib/contacts/errors");

    await assert.rejects(
      updateContactProperty(editor.id, "profileKey", `https://www.LinkedIn.com/in/zz-profile-edit-taken/`, BD_ID, { database: tx }),
      (e: unknown) => {
        assert.ok(e instanceof ProfileKeyTakenError, `expected ProfileKeyTakenError, got ${String(e)}`);
        assert.equal(e.owner.id, holder.id);
        assert.equal(e.owner.name, "Hugo Holder");
        assert.equal(e.owner.mergedInto, undefined);
        return true;
      },
    );
    await assertNothingWritten(tx, editor.id);
  });
});

test("a key held by a contact already merged away is reported with its survivor", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { survivor, holder, editor } = await seedPeople(tx, { mergedInto: true });
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
    const { ProfileKeyTakenError } = await import("@/lib/contacts/errors");

    await assert.rejects(
      updateContactProperty(editor.id, "profileKey", KEY, BD_ID, { database: tx }),
      (e: unknown) => {
        assert.ok(e instanceof ProfileKeyTakenError, `expected ProfileKeyTakenError, got ${String(e)}`);
        assert.equal(e.owner.id, holder.id);
        assert.deepEqual(e.owner.mergedInto, { id: survivor.id, name: "Sol Survivor" });
        return true;
      },
    );
    await assertNothingWritten(tx, editor.id);
  });
});

test("the real 23505 from person_profile_key_unique is what isProfileKeyUniqueViolation recognises", async () => {
  await inRolledBackTransaction(async (tx) => {
    await seedPeople(tx);
    const { person } = await import("@/db/schema");
    const { isProfileKeyUniqueViolation } = await import("@/lib/contacts/errors");
    let raw: unknown;
    try {
      await tx.transaction(async (inner) => {
        await inner.insert(person).values({ firstName: "Dup", profileKey: KEY });
      });
    } catch (err) {
      raw = err;
    }
    assert.ok(raw, "the duplicate insert must fail");
    assert.equal(isProfileKeyUniqueViolation(raw), true);
  });
});

test("a free key is written with its history row", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { editor } = await seedPeople(tx);
    const { updateContactProperty } = await import("@/lib/contacts/propertyEditDb");
    const { personPropertyHistory } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const updated = await updateContactProperty(editor.id, "profileKey", "https://uk.linkedin.com/in/ZZ-Free/", BD_ID, { database: tx });
    assert.equal(updated.profileKey, "uk.linkedin.com/in/zz-free");
    const history = await tx.select().from(personPropertyHistory).where(eq(personPropertyHistory.personId, editor.id));
    assert.equal(history.length, 1);
    assert.equal(history[0]!.property, "profileKey");
    assert.equal(history[0]!.newValue, "uk.linkedin.com/in/zz-free");
    assert.equal(history[0]!.changedByBdId, BD_ID);
  });
});
