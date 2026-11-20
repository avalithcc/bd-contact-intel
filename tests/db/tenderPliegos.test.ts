/**
 * The pliego download against the scratch database: which tenders are picked, and the guarded insert. Opt-in and fail-closed like
 * the other db tests; every test runs in a transaction a sentinel throw rolls back.
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

const DAY = 24 * 3600 * 1000;
async function seedTender(tx: Tx, o: { opening: number; ai?: boolean | null; override?: boolean | null }) {
  const { tender } = await import("@/db/schema");
  const tag = Math.random().toString(36).slice(2);
  const [t] = await tx
    .insert(tender)
    .values({ processNumber: `ZZ-P-${tag}`, name: "ZZ", openingAt: new Date(Date.now() + o.opening * DAY), aiRelevant: o.ai ?? null, relevanceOverride: o.override ?? null })
    .returning();
  return t!;
}


test("a tender with ANY document, the owner's included, is never selected; one without is, soonest opening first", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { bd, tenderDocument } = await import("@/db/schema");
    const { selectTendersWithoutDocument } = await import("@/lib/tenders/pliegoRunDeps");
    const [owner] = await tx.insert(bd).values({ name: "ZZ", email: `zz-${Math.random().toString(36).slice(2)}@example.test`, role: "admin" }).returning();
    const hand = await seedTender(tx, { opening: 5 });
    const bare = await seedTender(tx, { opening: 9 });
    const sooner = await seedTender(tx, { opening: 4 });
    const no = await seedTender(tx, { opening: 5, ai: false });
    const closed = await seedTender(tx, { opening: -1 });
    await tx.insert(tenderDocument).values({ tenderId: hand.id, storagePath: "u/d/x.pdf", filename: "x.pdf", sizeBytes: 10, uploadedByBdId: owner!.id });
    const ids = (await selectTendersWithoutDocument(1000, tx)).rows.map((r) => r.id);
    assert.ok(!ids.includes(hand.id) && !ids.includes(no.id) && !ids.includes(closed.id));
    assert.ok(ids.indexOf(sooner.id) >= 0 && ids.indexOf(sooner.id) < ids.indexOf(bare.id));
  });
});

test("the guarded insert writes once, and never adds a second document to a tender that has one", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { bd, tenderDocument } = await import("@/db/schema");
    const { addTenderDocument } = await import("@/lib/tenders/workspace");
    const { eq } = await import("drizzle-orm");
    const [owner] = await tx.insert(bd).values({ name: "ZZ", email: `zz-${Math.random().toString(36).slice(2)}@example.test`, role: "admin" }).returning();
    const t = await seedTender(tx, { opening: 5 });
    const input = { tenderId: t.id, storagePath: "u/d/p.pdf", filename: "p.pdf", sizeBytes: 10, actorBdId: owner!.id, onlyIfNone: true };
    assert.ok(await addTenderDocument(input, tx));
    assert.equal(await addTenderDocument(input, tx), null);
    assert.equal((await tx.select().from(tenderDocument).where(eq(tenderDocument.tenderId, t.id))).length, 1);
    assert.ok(await addTenderDocument({ ...input, storagePath: "u/d/p2.pdf", onlyIfNone: false }, tx), "the manual upload still always adds");
  });
});
