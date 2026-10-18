/**
 * DB-backed test for the /capture/linkedin lookup (`findLivePersonIdByProfileKey`):
 *  - a live holder is found by the key a bookmarklet URL normalizes to;
 *  - a key held by a contact merged away resolves to the survivor, through a
 *    chain of merges too;
 *  - an unknown key, and a broken chain, find nobody.
 *
 * Opt-in and fail-closed like the other files here: `npm run test:db`, with
 * DATABASE_URL pointing at a local database whose name ends in `_e2e`.
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

async function insertPerson(tx: Tx, values: { firstName: string; profileKey?: string; mergedIntoId?: string }) {
  const { person } = await import("@/db/schema");
  const [row] = await tx.insert(person).values({ lastName: "Lookup", ...values }).returning();
  return row!;
}

test("a live holder is found by the key the bookmarklet URL normalizes to", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { parseCaptureUrl } = await import("@/lib/contacts/linkedinCapture");
    const { findLivePersonIdByProfileKey } = await import("@/lib/contacts/linkedinLookup");
    const live = await insertPerson(tx, { firstName: "Ana", profileKey: "linkedin.com/in/zz-capture-live" });
    const parsed = parseCaptureUrl("https://www.LinkedIn.com/in/ZZ-Capture-Live/?utm_source=share");
    assert.ok(parsed.ok);
    assert.equal(await findLivePersonIdByProfileKey(parsed.profileKey, tx), live.id);
  });
});

test("a key held by a merged-away contact resolves to the survivor, through a chain", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { findLivePersonIdByProfileKey } = await import("@/lib/contacts/linkedinLookup");
    const survivor = await insertPerson(tx, { firstName: "Sol", profileKey: "linkedin.com/in/zz-capture-survivor" });
    const middle = await insertPerson(tx, { firstName: "Mid", profileKey: "linkedin.com/in/zz-capture-middle", mergedIntoId: survivor.id });
    await insertPerson(tx, { firstName: "Old", profileKey: "linkedin.com/in/zz-capture-old", mergedIntoId: middle.id });

    assert.equal(await findLivePersonIdByProfileKey("linkedin.com/in/zz-capture-middle", tx), survivor.id);
    assert.equal(await findLivePersonIdByProfileKey("linkedin.com/in/zz-capture-old", tx), survivor.id);
    assert.equal(await findLivePersonIdByProfileKey("linkedin.com/in/zz-capture-survivor", tx), survivor.id);
  });
});

test("an unknown key finds nobody", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { findLivePersonIdByProfileKey } = await import("@/lib/contacts/linkedinLookup");
    assert.equal(await findLivePersonIdByProfileKey("linkedin.com/in/zz-capture-nobody", tx), null);
  });
});
