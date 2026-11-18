/**
 * Tender relevance against the scratch database: the human override, unclassified rows, and the two list views. Opt-in and
 * fail-closed like tenders.test.ts; every test rolls back and reads only its own ZZ- rows.
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
  const [me] = await tx.insert(bd).values({ email: `zz-rel-${tag}@example.test`, name: "ZZ Rel" }).returning();
  return me!.id;
}

const workbook = () => import("../support/tendersWorkbook");
const NOW = new Date("2026-11-18T15:00:00.000Z");

/** A classifier that answers from a table of process number to verdict, built with the real key builder. */
async function classifierFrom(answers: Record<string, { relevant: boolean; reason: string }>) {
  const { tenderKey } = await import("@/lib/tenders/parse");
  return async (items: readonly { processNumber: string }[]) => {
    const out = new Map<string, { relevant: boolean; reason: string }>();
    for (const t of items) if (answers[t.processNumber]) out.set(tenderKey(t.processNumber), answers[t.processNumber]!);
    return out;
  };
}

const mine = <T extends { processNumber: string }>(rows: T[]) => rows.filter((r) => r.processNumber.startsWith("ZZ-R-"));

test("a human override survives a re-import and the model's new verdict never overwrites it", async () => {
  const { importTenderFile } = await import("@/lib/tenders/importFile");
  const { setTenderRelevance } = await import("@/lib/tenders/relevanceDb");
  const { listTenders } = await import("@/lib/tenders/queries");
  const { tender } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { buildXls, portalRow } = await workbook();
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx);
    const no = await classifierFrom({ "ZZ-R-1": { relevant: false, reason: "Compra de equipamiento" } });
    await importTenderFile(buildXls([portalRow({ 0: "ZZ-R-1", 2: "Licencias Pfsense Plus" })]), actor, tx as never, no);
    const [row] = await tx.select().from(tender).where(eq(tender.processNumber, "ZZ-R-1"));
    assert.equal(row!.aiRelevant, false);

    assert.equal(await setTenderRelevance(row!.id, "relevant", tx as never, actor), true);

    // The importer itself never sends a human-decided row to the model, so force the verdict through the write path: a model
    // NO written over a human YES must change the verdict columns and nothing else.
    const { importTenders } = await import("@/lib/tenders/importDb");
    const { tenderKey, parseTenderSheet } = await import("@/lib/tenders/parse");
    const { readSheetRows } = await import("@/lib/tenders/readSheet");
    const { tenders } = parseTenderSheet(readSheetRows(buildXls([portalRow({ 0: "ZZ-R-1", 2: "Licencias Pfsense Plus" })])));
    await importTenders(tenders, actor, tx as never, new Map([[tenderKey("ZZ-R-1"), { relevant: false, reason: "Otra vez NO" }]]));
    const [after] = await tx.select().from(tender).where(eq(tender.processNumber, "ZZ-R-1"));
    assert.equal(after!.aiReason, "Otra vez NO");
    assert.equal(after!.relevanceOverride, true);
    const list = await listTenders("relevant", NOW, 500, tx as never);
    assert.ok(mine(list.rows).some((r) => r.processNumber === "ZZ-R-1"), "the human-relevant tender is in the default view");

    // Taking the call back returns the decision to the model, which said NO.
    await setTenderRelevance(row!.id, "auto", tx as never, actor);
    const again = await listTenders("relevant", NOW, 500, tx as never);
    assert.ok(!mine(again.rows).some((r) => r.processNumber === "ZZ-R-1"));
  });
});

test("a human NO beats a model YES and a tender a human decided is not re-sent to the model", async () => {
  const { importTenderFile } = await import("@/lib/tenders/importFile");
  const { setTenderRelevance } = await import("@/lib/tenders/relevanceDb");
  const { listTenders } = await import("@/lib/tenders/queries");
  const { tender } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { buildXls, portalRow } = await workbook();
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx);
    const yes = await classifierFrom({ "ZZ-R-2": { relevant: true, reason: "Desarrollo de software" } });
    await importTenderFile(buildXls([portalRow({ 0: "ZZ-R-2" })]), actor, tx as never, yes);
    const [row] = await tx.select().from(tender).where(eq(tender.processNumber, "ZZ-R-2"));
    await setTenderRelevance(row!.id, "irrelevant", tx as never, actor);
    const sent: string[] = [];
    await importTenderFile(buildXls([portalRow({ 0: "ZZ-R-2", 2: "Otro titulo" })]), actor, tx as never, async (items) => {
      sent.push(...items.map((i) => i.processNumber));
      return new Map();
    });
    assert.deepEqual(sent, []);
    const list = await listTenders("relevant", NOW, 500, tx as never);
    assert.ok(!mine(list.rows).some((r) => r.processNumber === "ZZ-R-2"));
  });
});

test("a tender the model could not classify still lands and is VISIBLE in the default view", async () => {
  const { importTenderFile } = await import("@/lib/tenders/importFile");
  const { listTenders } = await import("@/lib/tenders/queries");
  const { buildXls, portalRow } = await workbook();
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx);
    const down = async () => new Map<string, { relevant: boolean; reason: string }>();
    const report = await importTenderFile(buildXls([portalRow({ 0: "ZZ-R-3", 4: "09/12/2026 10:00 Hrs." })]), actor, tx as never, down);
    assert.equal(report.created, 1);
    assert.equal(report.unclassified, 1);
    const list = await listTenders("relevant", NOW, 500, tx as never);
    assert.deepEqual(mine(list.rows).map((r) => r.processNumber), ["ZZ-R-3"]);
  });
});

test("a classifier that throws is not the import's problem: the file still imports unclassified", async () => {
  const { importTenderFile } = await import("@/lib/tenders/importFile");
  const { buildXls, portalRow } = await workbook();
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx);
    const report = await importTenderFile(buildXls([portalRow({ 0: "ZZ-R-4" })]), actor, tx as never, async () => {
      throw new Error("gateway down");
    });
    assert.equal(report.created, 1);
    assert.equal(report.unclassified, 1);
  });
});

test("an unchanged but never-classified row gets its verdict on the next import", async () => {
  const { importTenderFile } = await import("@/lib/tenders/importFile");
  const { tender } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { buildXls, portalRow } = await workbook();
  await inRolledBackTransaction(async (tx) => {
    const actor = await seedBd(tx);
    const xls = buildXls([portalRow({ 0: "ZZ-R-5" })]);
    await importTenderFile(xls, actor, tx as never, async () => new Map());
    const ok = await classifierFrom({ "ZZ-R-5": { relevant: true, reason: "Software a medida" } });
    const report = await importTenderFile(xls, actor, tx as never, ok);
    assert.deepEqual([report.created, report.updated, report.unchanged, report.classified], [0, 0, 1, 1]);
    const [row] = await tx.select().from(tender).where(eq(tender.processNumber, "ZZ-R-5"));
    assert.deepEqual([row!.aiRelevant, row!.aiReason], [true, "Software a medida"]);
  });
});

test("default view: relevant and unclassified, open only, furthest opening first; 'all' adds the discarded and the closed with reasons", async () => {
  const { listTenders } = await import("@/lib/tenders/queries");
  const { tender } = await import("@/db/schema");
  const d = (iso: string) => new Date(iso);
  await inRolledBackTransaction(async (tx) => {
    await tx.insert(tender).values([
      { processNumber: "ZZ-R-NEAR", name: "near", openingAt: d("2026-11-19T18:00:00Z"), aiRelevant: true, aiReason: "Software" },
      { processNumber: "ZZ-R-FAR", name: "far", openingAt: d("2026-12-20T13:00:00Z"), aiRelevant: true, aiReason: "Software" },
      { processNumber: "ZZ-R-MID", name: "mid", openingAt: d("2026-12-01T13:00:00Z") },
      { processNumber: "ZZ-R-NOISE", name: "noise", openingAt: d("2026-12-10T13:00:00Z"), aiRelevant: false, aiReason: "Drenaje" },
      { processNumber: "ZZ-R-SAVED", name: "saved", openingAt: d("2026-12-05T13:00:00Z"), aiRelevant: false, aiReason: "Equipamiento", relevanceOverride: true },
      { processNumber: "ZZ-R-OLD", name: "old", openingAt: d("2026-11-01T13:00:00Z"), aiRelevant: true, aiReason: "Software" },
      { processNumber: "ZZ-R-OLDNOISE", name: "oldnoise", openingAt: d("2026-11-02T13:00:00Z"), aiRelevant: false, aiReason: "Obra" },
    ]);
    const def = await listTenders("relevant", NOW, 500, tx as never);
    assert.deepEqual(mine(def.rows).map((r) => r.processNumber), ["ZZ-R-FAR", "ZZ-R-SAVED", "ZZ-R-MID", "ZZ-R-NEAR"]);

    const all = await listTenders("all", NOW, 500, tx as never);
    const rows = mine(all.rows);
    assert.deepEqual(rows.map((r) => r.processNumber), ["ZZ-R-FAR", "ZZ-R-NOISE", "ZZ-R-SAVED", "ZZ-R-MID", "ZZ-R-NEAR", "ZZ-R-OLDNOISE", "ZZ-R-OLD"]);
    assert.equal(rows.find((r) => r.processNumber === "ZZ-R-NOISE")!.aiReason, "Drenaje");
    // The counts let the page say how many the default view is hiding.
    assert.ok(all.total >= def.total + 3);
    assert.equal(def.all, all.total);
  });
});
