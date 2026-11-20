/**
 * The portal cache against the scratch database: which tenders are due, and how an outcome is stored. Opt-in and fail-closed like
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

test("due = open, not decided no, not fetched in the last 12 hours; never-fetched first", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { savePortalOutcome, selectDueTenders } = await import("@/lib/tenders/portalRunDeps");
    const fresh = await seedTender(tx, { opening: 5 });
    const stale = await seedTender(tx, { opening: 6 });
    const never = await seedTender(tx, { opening: 7 });
    const closed = await seedTender(tx, { opening: -30 }); // well past the grace window
    const no = await seedTender(tx, { opening: 5, ai: false });
    const rescued = await seedTender(tx, { opening: 5, ai: false, override: true });
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);
    await savePortalOutcome({ id: fresh.id, processNumber: fresh.processNumber, openingAt: fresh.openingAt }, { kind: "not_found" }, hoursAgo(1), tx);
    await savePortalOutcome({ id: stale.id, processNumber: stale.processNumber, openingAt: stale.openingAt }, { kind: "not_found" }, hoursAgo(13), tx);
    const { rows } = await selectDueTenders(1000, tx);
    const ids = rows.map((r) => r.id);
    assert.ok(!ids.includes(fresh.id) && !ids.includes(closed.id) && !ids.includes(no.id));
    assert.ok(ids.includes(stale.id) && ids.includes(never.id) && ids.includes(rescued.id));
    assert.ok(ids.indexOf(never.id) < ids.indexOf(stale.id), "a never-fetched tender sorts before a stale one");
  });
});

test("a failed refresh keeps the last good data; a success clears the error; two rows never exist for one tender", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { savePortalOutcome } = await import("@/lib/tenders/portalRunDeps");
    const { tenderPortal } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const t = await seedTender(tx, { opening: 5 });
    const c = { id: t.id, processNumber: t.processNumber, openingAt: t.openingAt };
    const fields = { objeto: "o", currency: null, contractDuration: "12 Meses", offerValidity: null, acceptsExtension: true, questionsUntil: new Date("2026-12-09T13:00:00Z"), openingAt: null, guaranteeOffer: null, guaranteeContract: null, guaranteeChallenge: null, circularCount: 0 };
    await savePortalOutcome(c, { kind: "ok", fields, portalUrl: "https://comprar.gob.ar/x" }, new Date(), tx);
    await savePortalOutcome(c, { kind: "error", message: "http_500" }, new Date(), tx);
    let rows = await tx.select().from(tenderPortal).where(eq(tenderPortal.tenderId, t.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.contractDuration, "12 Meses");
    assert.equal(rows[0]!.fetchError, "http_500");
    assert.equal(rows[0]!.questionsUntil?.toISOString(), "2026-12-09T13:00:00.000Z");
    await savePortalOutcome(c, { kind: "ok", fields, portalUrl: "https://comprar.gob.ar/x" }, new Date(), tx);
    rows = await tx.select().from(tenderPortal).where(eq(tenderPortal.tenderId, t.id));
    assert.equal(rows[0]!.fetchError, null);
  });
});

test("a moved opening is written once with its old and new instant; the same date again writes nothing; a repeat flip logs again", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { applyOpeningCorrection } = await import("@/lib/tenders/portalRunDeps");
    const { tender } = await import("@/db/schema");
    const { eq, sql } = await import("drizzle-orm");
    const t = await seedTender(tx, { opening: 5 });
    const c = { id: t.id, processNumber: t.processNumber, openingAt: t.openingAt };
    const later = new Date(t.openingAt.getTime() + 7 * DAY);
    const events = async () => (await tx.execute(sql`select actor_bd_id, detail from tender_event where tender_id = ${t.id}::uuid and kind = 'opening' order by created_at`)) as unknown as { actor_bd_id: string | null; detail: { from: string; to: string } }[];
    assert.equal(await applyOpeningCorrection(c, { from: t.openingAt, to: later }, tx), true);
    assert.equal(await applyOpeningCorrection(c, { from: t.openingAt, to: later }, tx), false);
    const [row] = await tx.select().from(tender).where(eq(tender.id, t.id));
    assert.equal(row!.openingAt.toISOString(), later.toISOString());
    let ev = await events();
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.actor_bd_id, null);
    assert.equal(new Date(ev[0]!.detail.from).getTime(), t.openingAt.getTime());
    assert.equal(new Date(ev[0]!.detail.to).getTime(), later.getTime());
    // The Excel import writes the stale date back; the next portal run corrects it again and the flip stays visible.
    await applyOpeningCorrection(c, { from: later, to: t.openingAt }, tx);
    ev = await events();
    assert.equal(ev.length, 2);
  });
});

test("selection: open by either source, a grace window for a tender never given a portal date, and the 12h rule still holds", async () => {
  await inRolledBackTransaction(async (tx) => {
    const { savePortalOutcome, selectDueTenders } = await import("@/lib/tenders/portalRunDeps");
    const { PORTAL_GRACE_DAYS } = await import("@/lib/tenders/portalRun");
    const stale = new Date(Date.now() - 13 * 3600 * 1000);
    const fields = (days: number | null) => ({ objeto: "o", currency: null, contractDuration: null, offerValidity: null, acceptsExtension: null, questionsUntil: null, openingAt: days === null ? null : new Date(Date.now() + days * DAY), guaranteeOffer: null, guaranteeContract: null, guaranteeChallenge: null, circularCount: 0 });
    const withPortal = async (t: Awaited<ReturnType<typeof seedTender>>, days: number | null, at = stale) =>
      savePortalOutcome({ id: t.id, processNumber: t.processNumber, openingAt: t.openingAt }, { kind: "ok", fields: fields(days), portalUrl: "u" }, at, tx);
    const movedOpen = await seedTender(tx, { opening: -2 });
    await withPortal(movedOpen, 5);
    const pastBoth = await seedTender(tx, { opening: -2 });
    await withPortal(pastBoth, -1);
    const noRowInside = await seedTender(tx, { opening: -(PORTAL_GRACE_DAYS - 1) });
    const noRowOutside = await seedTender(tx, { opening: -(PORTAL_GRACE_DAYS + 1) });
    const freshOpen = await seedTender(tx, { opening: 5 });
    await withPortal(freshOpen, 5, new Date());
    const freshMoved = await seedTender(tx, { opening: -2 });
    await withPortal(freshMoved, 5, new Date());
    const ids = (await selectDueTenders(1000, tx)).rows.map((r) => r.id);
    assert.ok(ids.includes(movedOpen.id), "past the CRM date but open per the portal is selected");
    assert.ok(!ids.includes(pastBoth.id), "past both dates is not");
    assert.ok(ids.includes(noRowInside.id), "no portal row, inside the grace window, is selected");
    assert.ok(!ids.includes(noRowOutside.id), "no portal row, outside the grace window, is not");
    assert.ok(!ids.includes(freshOpen.id) && !ids.includes(freshMoved.id), "fetched in the last 12h stays skipped, whichever source says open");
  });
});
