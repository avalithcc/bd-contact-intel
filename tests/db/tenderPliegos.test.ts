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
    const closed = await seedTender(tx, { opening: -30 }); // well past the grace window
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

const HOUR = 3600 * 1000;
async function stamp(tx: Tx, tenderId: string, error: string | null, hoursAgo: number) {
  const { savePliegoAttempt } = await import("@/lib/tenders/pliegoRunDeps");
  await savePliegoAttempt({ id: tenderId, processNumber: "x" }, error, new Date(Date.now() - hoursAgo * HOUR), tx);
}

test("cooldown: absent tenders rest 24h, failed ones 2h, a past cooldown or a success is selected again, and the count says how many rest", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { selectTendersWithoutDocument } = await import("@/lib/tenders/pliegoRunDeps");
    const fresh = await seedTender(tx, { opening: 5 });
    const absentRecent = await seedTender(tx, { opening: 5 });
    const absentOld = await seedTender(tx, { opening: 5 });
    const failedRecent = await seedTender(tx, { opening: 5 });
    const failedOld = await seedTender(tx, { opening: 5 });
    const succeeded = await seedTender(tx, { opening: 5 });
    await stamp(tx, absentRecent.id, "no_document", 3);
    await stamp(tx, absentOld.id, "not_found", 25);
    await stamp(tx, failedRecent.id, "error: timeout", 1);
    await stamp(tx, failedOld.id, "not_pdf", 3);
    await stamp(tx, succeeded.id, null, 0);
    const before = await selectTendersWithoutDocument(1000, tx);
    const ids = before.rows.map((r) => r.id);
    assert.ok(!ids.includes(absentRecent.id) && !ids.includes(failedRecent.id));
    for (const t of [fresh, absentOld, failedOld, succeeded]) assert.ok(ids.includes(t.id));
    assert.ok(before.cooling >= 2);
    const limited = await selectTendersWithoutDocument(1, tx);
    assert.equal(limited.total, before.total, "total ignores the limit and the cooling rows");
    assert.equal(limited.cooling, before.cooling);
  });
});

test("a tender that gained a document is excluded whatever its flag says; a row made by the pliego run keeps the portal job interested", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { bd, tenderDocument, tenderPortal } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { selectTendersWithoutDocument } = await import("@/lib/tenders/pliegoRunDeps");
    const { selectDueTenders } = await import("@/lib/tenders/portalRunDeps");
    const [owner] = await tx.insert(bd).values({ name: "ZZ", email: `zz-${Math.random().toString(36).slice(2)}@example.test`, role: "admin" }).returning();
    const t = await seedTender(tx, { opening: 5 });
    await tx.insert(tenderDocument).values({ tenderId: t.id, storagePath: "u/d/y.pdf", filename: "y.pdf", sizeBytes: 10, uploadedByBdId: owner!.id });
    await stamp(tx, t.id, "no_document", 100);
    assert.ok(!(await selectTendersWithoutDocument(1000, tx)).rows.some((r) => r.id === t.id));
    const u = await seedTender(tx, { opening: 5 });
    await stamp(tx, u.id, "no_document", 0);
    const [row] = await tx.select().from(tenderPortal).where(eq(tenderPortal.tenderId, u.id));
    assert.equal(row!.portalUrl, null);
    assert.ok(row!.fetchedAt.getTime() < Date.now() - 12 * HOUR);
    assert.ok((await selectDueTenders(1000, tx)).rows.some((r) => r.id === u.id));
    await stamp(tx, u.id, null, 0);
    assert.equal((await tx.select().from(tenderPortal).where(eq(tenderPortal.tenderId, u.id))).length, 1, "upsert, never a second row");
  });
});

test("pliego selection: open by either source, past both is not, and a document excludes either way", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { bd, tenderDocument, tenderPortal } = await import("@/db/schema");
    const { selectTendersWithoutDocument } = await import("@/lib/tenders/pliegoRunDeps");
    const [owner] = await tx.insert(bd).values({ name: "ZZ", email: `zz-${Math.random().toString(36).slice(2)}@example.test`, role: "admin" }).returning();
    const portal = async (t: Awaited<ReturnType<typeof seedTender>>, days: number) => void (await tx.insert(tenderPortal).values({ tenderId: t.id, fetchedAt: new Date(), openingAt: new Date(Date.now() + days * DAY) }));
    const movedOpen = await seedTender(tx, { opening: -2 });
    await portal(movedOpen, 5);
    const pastBoth = await seedTender(tx, { opening: -2 });
    await portal(pastBoth, -1);
    const movedWithDoc = await seedTender(tx, { opening: -2 });
    await portal(movedWithDoc, 5);
    const futureWithDoc = await seedTender(tx, { opening: 5 });
    const graceNoPortal = await seedTender(tx, { opening: -2 });
    for (const t of [movedWithDoc, futureWithDoc]) await tx.insert(tenderDocument).values({ tenderId: t.id, storagePath: `u/d/${t.id}.pdf`, filename: "x.pdf", sizeBytes: 10, uploadedByBdId: owner!.id });
    const ids = (await selectTendersWithoutDocument(1000, tx)).rows.map((r) => r.id);
    assert.ok(ids.includes(movedOpen.id), "past the CRM date but open per the portal is selected");
    assert.ok(!ids.includes(pastBoth.id), "past both is not");
    assert.ok(!ids.includes(movedWithDoc.id) && !ids.includes(futureWithDoc.id), "a document excludes it either way");
    assert.ok(ids.includes(graceNoPortal.id), "no portal date, inside the grace window, is selected");
  });
});
