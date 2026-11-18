/**
 * Tender import and list against the scratch database. Opt-in and fail-closed like the other db tests: `npm run test:db` with
 * DATABASE_URL a local `_e2e` database. The tender table is shared, so every test runs in a transaction that a sentinel throw
 * rolls back, and it reads the table only through rows it wrote itself (process numbers prefixed ZZ-).
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

async function seedBd(tx: Tx) {
  const { bd } = await import("@/db/schema");
  const tag = Math.random().toString(36).slice(2);
  const [me] = await tx.insert(bd).values({ email: `zz-tender-${tag}@example.test`, name: "ZZ Tender" }).returning();
  return me!.id;
}

// The workbook builder is a test-support module, so the guard allows it only through a dynamic import.
const workbook = () => import("../support/tendersWorkbook");

async function file() {
  const { buildXls, portalRow } = await workbook();
  return buildXls([
    portalRow({ 0: "ZZ-001-LPR26" }),
    portalRow({ 0: "ZZ-002-CDI26", 2: "Mantenimiento de sistemas", 4: "19/11/2026 15:00 Hrs." }),
  ]);
}

test("importing the same file twice creates nothing the second time and reports unchanged", async () => {
  const { importTenderFile } = await import("@/lib/tenders/importFile");
  const { tender, auditLog } = await import("@/db/schema");
  const { like, eq } = await import("drizzle-orm");
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx);
    const first = await importTenderFile(await file(), actor, tx as never);
    assert.deepEqual([first.created, first.updated, first.unchanged], [2, 0, 0]);

    const second = await importTenderFile(await file(), actor, tx as never);
    assert.deepEqual([second.created, second.updated, second.unchanged], [0, 0, 2]);

    const rows = await tx.select().from(tender).where(like(tender.processNumber, "ZZ-%"));
    assert.equal(rows.length, 2);
    // Only the first import wrote, so only it left an audit row.
    const audits = await tx.select().from(auditLog).where(eq(auditLog.actorBdId, actor));
    assert.equal(audits.length, 1);
    assert.equal((audits[0]!.metadata as { created: number }).created, 2);
  });
});

test("a changed title updates the same row in place and an import never touches our triage or note", async () => {
  const { importTenderFile } = await import("@/lib/tenders/importFile");
  const { setTenderTriage } = await import("@/lib/tenders/importDb");
  const { tender } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { buildXls, portalRow } = await workbook();
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx);
    await importTenderFile(buildXls([portalRow({ 0: "ZZ-010-LPR26" })]), actor, tx as never);
    const [before] = await tx.select().from(tender).where(eq(tender.processNumber, "ZZ-010-LPR26"));
    await setTenderTriage(before!.id, "vamos", tx as never);
    await tx.update(tender).set({ note: "call the buyer" }).where(eq(tender.id, before!.id));

    const report = await importTenderFile(
      buildXls([portalRow({ 0: "ZZ-010-LPR26", 2: "Servicio de desarrollo - circular 1" })]),
      actor,
      tx as never,
    );
    assert.deepEqual([report.created, report.updated, report.unchanged], [0, 1, 0]);

    const [after] = await tx.select().from(tender).where(eq(tender.processNumber, "ZZ-010-LPR26"));
    assert.equal(after!.id, before!.id);
    assert.match(after!.name, /circular 1/);
    assert.equal(after!.triageStatus, "vamos");
    assert.equal(after!.note, "call the buyer");
  });
});

test("the process number is unique at the database, not only in the planner", async () => {
  const { tender } = await import("@/db/schema");
  await inRolledBackTransaction(async (tx) => {
    const row = { processNumber: "ZZ-020-LPR26", name: "x", openingAt: new Date() };
    await tx.insert(tender).values(row);
    await assert.rejects(() => tx.transaction((inner) => inner.insert(tender).values(row)), /unique|duplicate/i);
  });
});

test("the list is soonest-opening first, closed tenders last and still present", async () => {
  const { listTenders } = await import("@/lib/tenders/queries");
  const { tender } = await import("@/db/schema");
  const now = new Date("2026-11-18T15:00:00.000Z");
  const d = (iso: string) => new Date(iso);
  await inRolledBackTransaction(async (tx) => {
    await tx.insert(tender).values([
      { processNumber: "ZZ-L-FAR", name: "far", openingAt: d("2026-12-10T13:00:00Z") },
      { processNumber: "ZZ-L-OLD", name: "old", openingAt: d("2026-11-01T13:00:00Z") },
      { processNumber: "ZZ-L-NEAR", name: "near", openingAt: d("2026-11-19T18:00:00Z") },
      { processNumber: "ZZ-L-RECENT", name: "recent", openingAt: d("2026-11-17T13:00:00Z") },
    ]);
    // The list runs on the transaction, so it sees the rows written above without committing them.
    const list = await listTenders(now, 500, tx as never);
    const mine = list.rows.filter((r) => r.processNumber.startsWith("ZZ-L-"));
    assert.deepEqual(
      mine.map((r) => [r.processNumber, r.daysLeft, r.closed]),
      [
        ["ZZ-L-NEAR", 1, false],
        ["ZZ-L-FAR", 22, false],
        ["ZZ-L-RECENT", -1, true],
        ["ZZ-L-OLD", -17, true],
      ],
    );
  });
});
