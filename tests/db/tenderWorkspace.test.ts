/**
 * The tender ficha's writes against the scratch database: the note, the triage log, the pliego and its analysis. Opt-in and
 * fail-closed like the other db tests; every test runs in a transaction a sentinel throw rolls back.
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

async function seed(tx: Tx) {
  const { bd, tender } = await import("@/db/schema");
  const tag = Math.random().toString(36).slice(2);
  const [me] = await tx.insert(bd).values({ email: `zz-tw-${tag}@example.test`, name: "ZZ Ana" }).returning();
  const [t] = await tx.insert(tender).values({ processNumber: `ZZ-W-${tag}`, name: "ZZ tender", openingAt: new Date("2026-12-09T13:00:00Z") }).returning();
  return { actor: me!.id, tenderId: t!.id };
}

const ANALYSIS = {
  summary: "Replica de infraestructura.",
  viability: "Encaja.",
  requirements: { registration: null, antecedents: null, guarantee: "5%", submissionDeadline: null, certifications: null, financialStanding: null, team: null, affidavits: null },
  pages: 24,
  mustListIncluded: true,
};

test("saving a note writes it on the tender and it appears in the progress log with who and when", async () => {
  const { saveTenderNote, getTenderDetail } = await import("@/lib/tenders/workspace");
  await inRolledBackTransaction(async (tx) => {
    const { actor, tenderId } = await seed(tx);
    assert.equal(await saveTenderNote(tenderId, "  Llamar al organismo  ", actor, tx as never), true);
    const detail = await getTenderDetail(tenderId, new Date(), tx as never);
    assert.equal(detail!.tender.note, "Llamar al organismo");
    assert.equal(detail!.events.length, 1);
    assert.equal(detail!.events[0]!.kind, "note");
    assert.equal(detail!.events[0]!.detail.text, "Llamar al organismo");
    assert.equal(detail!.events[0]!.actor, "ZZ Ana");
    assert.ok(detail!.events[0]!.createdAt instanceof Date);
  });
});

test("an unchanged note logs nothing, clearing it logs the clearing, and an unknown tender is reported", async () => {
  const { saveTenderNote, getTenderDetail } = await import("@/lib/tenders/workspace");
  await inRolledBackTransaction(async (tx) => {
    const { actor, tenderId } = await seed(tx);
    await saveTenderNote(tenderId, "hola", actor, tx as never);
    await saveTenderNote(tenderId, "hola", actor, tx as never);
    await saveTenderNote(tenderId, "   ", actor, tx as never);
    const detail = await getTenderDetail(tenderId, new Date(), tx as never);
    assert.equal(detail!.tender.note, null);
    assert.deepEqual(detail!.events.map((e) => e.detail.text), ["", "hola"]);
    assert.equal(await saveTenderNote("55555555-5555-4555-8555-555555555555", "x", actor, tx as never), false);
  });
});

test("a triage change logs from and to with the actor, and re-selecting the same state logs nothing", async () => {
  const { setTenderTriage } = await import("@/lib/tenders/importDb");
  const { getTenderDetail } = await import("@/lib/tenders/workspace");
  await inRolledBackTransaction(async (tx) => {
    const { actor, tenderId } = await seed(tx);
    assert.equal(await setTenderTriage(tenderId, "en_analisis", tx as never, actor), true);
    assert.equal(await setTenderTriage(tenderId, "en_analisis", tx as never, actor), true);
    const detail = await getTenderDetail(tenderId, new Date(), tx as never);
    assert.equal(detail!.tender.triageStatus, "en_analisis");
    assert.deepEqual(detail!.events.map((e) => [e.kind, e.detail.from, e.detail.to, e.actor]), [["triage", "a_revisar", "en_analisis", "ZZ Ana"]]);
  });
});

test("a new upload becomes the current document and starts with no analysis: the old reading stays on the old file", async () => {
  const { addTenderDocument, saveTenderAnalysis, getTenderDetail } = await import("@/lib/tenders/workspace");
  const { currentDocument } = await import("@/lib/tenders/analysis");
  await inRolledBackTransaction(async (tx) => {
    const { actor, tenderId } = await seed(tx);
    const first = await addTenderDocument({ tenderId, storagePath: `${actor}/a/one.pdf`, filename: "one.pdf", sizeBytes: 1000, actorBdId: actor }, tx as never);
    assert.ok(first);
    assert.equal(await saveTenderAnalysis(first, ANALYSIS, actor, tx as never), true);
    let detail = await getTenderDetail(tenderId, new Date(), tx as never);
    assert.deepEqual(currentDocument(detail!.documents)!.analysis, { ...ANALYSIS });

    await new Promise((r) => setTimeout(r, 15));
    const second = await addTenderDocument({ tenderId, storagePath: `${actor}/b/two.pdf`, filename: "two.pdf", sizeBytes: 2000, actorBdId: actor }, tx as never);
    assert.ok(second && second !== first);
    detail = await getTenderDetail(tenderId, new Date(), tx as never);
    const current = currentDocument(detail!.documents)!;
    assert.equal(current.id, second);
    assert.equal(current.analysis, null);
    assert.equal(detail!.documents.find((d) => d.id === first)!.analysis?.summary, ANALYSIS.summary);
    assert.deepEqual(detail!.events.map((e) => e.kind).sort(), ["analysis", "document", "document"]);
    assert.equal(await addTenderDocument({ tenderId: "55555555-5555-4555-8555-555555555555", storagePath: "x/y/z.pdf", filename: "z.pdf", sizeBytes: 1, actorBdId: actor }, tx as never), null);
  });
});
