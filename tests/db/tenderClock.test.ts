/**
 * The tender clock against the scratch database: assigning an owner (and the log entry with the actor), the owner in the list,
 * the digest's reads, and the SQL relevance fragment held to the TypeScript definition. Opt-in and fail-closed like the other
 * tender db tests; every test rolls back and reads only its own ZZ- rows.
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

const NOW = new Date("2026-11-18T11:30:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000 + 3 * 3_600_000);
const tag = () => Math.random().toString(36).slice(2);

async function seedBd(tx: Tx, name: string, over: { emailRemindersEnabled?: boolean } = {}) {
  const { bd } = await import("@/db/schema");
  const [row] = await tx.insert(bd).values({ email: `zz-tc-${tag()}@example.test`, name, ...over }).returning();
  return row!.id;
}

async function seedTender(tx: Tx, key: string, openingAt: Date, over: Record<string, unknown> = {}) {
  const { tender } = await import("@/db/schema");
  const [row] = await tx.insert(tender).values({ processNumber: `ZZ-C-${key}-${tag()}`, name: `ZZ ${key}`, openingAt, ...over }).returning();
  return row!.id;
}

test("assigning an owner sets it, logs who did it and to whom, and shows in the ficha and the list; choosing the same owner logs nothing", async () => {
  const { setTenderOwner, getTenderDetail } = await import("@/lib/tenders/workspace");
  const { listTenders } = await import("@/lib/tenders/queries");
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx, "ZZ Actor");
    const owner = await seedBd(tx, "ZZ Owner");
    const id = await seedTender(tx, "own", days(5));
    assert.equal(await setTenderOwner(id, owner, actor, tx as never), true);
    assert.equal(await setTenderOwner(id, owner, actor, tx as never), true, "same owner again is still a success");
    const detail = await getTenderDetail(id, NOW, tx as never);
    assert.equal(detail!.tender.ownerBdId, owner);
    assert.ok(detail!.bdOptions.some((o) => o.id === owner && o.name === "ZZ Owner"));
    const owned = detail!.events.filter((e) => e.kind === "owner");
    assert.equal(owned.length, 1, "the second, unchanged call logged nothing");
    assert.deepEqual(owned[0]!.detail, { to: "ZZ Owner" });
    assert.equal(owned[0]!.actor, "ZZ Actor");
    const row = (await listTenders("all", NOW, 500, tx as never)).rows.find((r) => r.id === id);
    assert.equal(row!.ownerName, "ZZ Owner");
  });
});

test("releasing logs an empty owner, and an unknown BD or tender writes nothing and returns false", async () => {
  const { setTenderOwner, getTenderDetail } = await import("@/lib/tenders/workspace");
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx, "ZZ Actor");
    const owner = await seedBd(tx, "ZZ Owner");
    const id = await seedTender(tx, "rel", days(5), { ownerBdId: owner });
    assert.equal(await setTenderOwner(id, null, actor, tx as never), true);
    const detail = await getTenderDetail(id, NOW, tx as never);
    assert.equal(detail!.tender.ownerBdId, null);
    assert.deepEqual(detail!.events.find((e) => e.kind === "owner")!.detail, { to: "" });
    assert.equal(await setTenderOwner(id, "99999999-9999-4999-8999-999999999999", actor, tx as never), false);
    assert.equal(await setTenderOwner("99999999-9999-4999-8999-999999999999", owner, actor, tx as never), false);
    assert.equal(await setTenderOwner("not-a-uuid", owner, actor, tx as never), false);
    assert.equal((await getTenderDetail(id, NOW, tx as never))!.events.filter((e) => e.kind === "owner").length, 1);
  });
});

test("deleting the owner BD releases the tender instead of blocking the delete (ON DELETE SET NULL)", async () => {
  const { bd, tender } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  await inRolledBackTransaction(async (tx) => {
    const owner = await seedBd(tx, "ZZ Leaver");
    const id = await seedTender(tx, "del", days(5), { ownerBdId: owner });
    await tx.delete(bd).where(eq(bd.id, owner));
    const [row] = await tx.select().from(tender).where(eq(tender.id, id));
    assert.equal(row!.ownerBdId, null);
  });
});

test("the digest read keeps open, not-decided-no tenders inside 16 days and agrees with tenderRelevance for every verdict combination", async () => {
  const { getClosingTendersForDigest } = await import("@/lib/tenders/digestQueries");
  const { tenderRelevance } = await import("@/lib/tenders/relevance");
  await inRolledBackTransaction(async (tx) => {
    const combos: [boolean | null, boolean | null][] = [[null, null], [true, null], [false, null], [null, true], [null, false], [true, false], [false, true]];
    const ids = new Map<string, [boolean | null, boolean | null]>();
    for (const [ai, human] of combos) ids.set(await seedTender(tx, `rel`, days(3), { aiRelevant: ai, relevanceOverride: human }), [ai, human]);
    const closedId = await seedTender(tx, "closed", new Date(NOW.getTime() - 3_600_000));
    const farId = await seedTender(tx, "far", days(40));
    const rows = await getClosingTendersForDigest(NOW, 500, tx as never);
    const got = new Set(rows.map((r) => r.id));
    assert.ok(!got.has(closedId), "a closed tender is never read");
    assert.ok(!got.has(farId), "a tender past the widest window is never read");
    for (const [id, [aiRelevant, relevanceOverride]] of ids) {
      const shown = tenderRelevance({ aiRelevant, aiReason: null, relevanceOverride }).state !== "irrelevant";
      assert.equal(got.has(id), shown, `ai=${aiRelevant} human=${relevanceOverride}`);
    }
  });
});

test("the digest read carries the owner and null for an unowned tender; recipients honour email_reminders_enabled", async () => {
  const { getClosingTendersForDigest, getTenderDigestRecipients } = await import("@/lib/tenders/digestQueries");
  await inRolledBackTransaction(async (tx) => {
    const owner = await seedBd(tx, "ZZ Owner");
    const muted = await seedBd(tx, "ZZ Muted", { emailRemindersEnabled: false });
    const mineId = await seedTender(tx, "mine", days(3), { ownerBdId: owner });
    const freeId = await seedTender(tx, "free", days(3));
    const rows = await getClosingTendersForDigest(NOW, 500, tx as never);
    assert.equal(rows.find((r) => r.id === mineId)!.owner!.bdId, owner);
    assert.equal(rows.find((r) => r.id === freeId)!.owner, null);
    const recipients = await getTenderDigestRecipients(500, tx as never);
    assert.ok(recipients.some((r) => r.bdId === owner));
    assert.ok(!recipients.some((r) => r.bdId === muted));
  });
});
