/**
 * Tender import: the parsing, the planning and the day count, none of which touch a database. The portal's date arrives as
 * "09/12/2026 10:00 Hrs." (dd/mm), the one value a hand-rolled `new Date()` would silently read as 12 September.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseOpeningDate, parseTenderSheet, tenderKey } from "@/lib/tenders/parse";
import { indexTendersByKey, planTenderImport, type StoredTender } from "@/lib/tenders/plan";
import { tenderTiming } from "@/lib/tenders/timing";
import { readSheetRows } from "@/lib/tenders/readSheet";
import { PORTAL_HEADER, buildXls, portalRow } from "../support/tendersWorkbook";

test("the portal date is dd/mm/yyyy in Argentina time: 09/12/2026 10:00 is 9 December, not 12 September", () => {
  const d = parseOpeningDate("09/12/2026 10:00 Hrs.");
  assert.ok(d);
  assert.equal(d.toISOString(), "2026-12-09T13:00:00.000Z"); // 10:00 at UTC-3
});

test("a date whose day is above 12 cannot be read the american way, and an impossible date is rejected", () => {
  assert.equal(parseOpeningDate("27/11/2026 14:30 Hrs.")?.toISOString(), "2026-11-27T17:30:00.000Z");
  assert.equal(parseOpeningDate("31/02/2026 10:00 Hrs."), null);
  assert.equal(parseOpeningDate("12/13/2026 10:00 Hrs."), null);
  assert.equal(parseOpeningDate("2026-12-09"), null);
  assert.equal(parseOpeningDate(""), null);
});

test("the sheet reader and parser take a real binary .xls and keep every column", () => {
  const xls = buildXls([portalRow(), portalRow({ 0: "15-0005-CDI26", 4: "19/11/2026 15:00 Hrs." })]);
  const parsed = parseTenderSheet(readSheetRows(xls));
  assert.equal(parsed.rejected.length, 0);
  assert.equal(parsed.tenders.length, 2);
  assert.deepEqual(parsed.tenders[0], {
    processNumber: "487-0018-LPR26",
    fileNumber: "EX-2026-00000001- -APN-GAYF#XX",
    name: "Servicio de desarrollo de software a medida",
    processType: "Licitación Privada",
    openingAt: new Date("2026-12-09T13:00:00.000Z"),
    portalStatus: "Publicado",
    executingUnit: "487 - Compras",
    financialAdminService: "105 - Organismo de Prueba",
  });
});

test("a file that is not the portal export is refused loudly instead of importing nothing", () => {
  const xls = buildXls([portalRow()], ["Foo", "Bar"]);
  assert.throws(() => parseTenderSheet(readSheetRows(xls)), /missing_columns/);
});

test("rows that cannot be imported are reported, never dropped silently", () => {
  const xls = buildXls([
    portalRow(),
    portalRow({ 0: "", 2: "no number" }),
    portalRow({ 0: "999-0001-LPR26", 4: "soon" }),
    portalRow(), // same process number twice in one file
  ]);
  const parsed = parseTenderSheet(readSheetRows(xls));
  assert.equal(parsed.tenders.length, 1);
  assert.deepEqual(
    parsed.rejected.map((r) => [r.line, r.reason]),
    [[3, "missing_number"], [4, "bad_date"], [5, "duplicate_in_file"]],
  );
});

function stored(t: ReturnType<typeof parseTenderSheet>["tenders"][number], id: string): StoredTender {
  return { id, ...t, aiRelevant: null, relevanceOverride: null };
}

test("importing the same file twice creates nothing the second time and reports every row unchanged", () => {
  const xls = buildXls([portalRow(), portalRow({ 0: "15-0005-CDI26", 4: "19/11/2026 15:00 Hrs." })]);
  const { tenders } = parseTenderSheet(readSheetRows(xls));

  const first = planTenderImport(tenders, indexTendersByKey([]));
  assert.equal(first.create.length, 2);

  const afterFirst = indexTendersByKey(first.create.map((t, i) => stored(t, `id-${i}`)));
  const second = planTenderImport(tenders, afterFirst);
  assert.equal(second.create.length, 0);
  assert.equal(second.update.length, 0);
  assert.equal(second.unchanged, 2);
});

test("a title changed in the portal updates in place, keyed on the process number", () => {
  const { tenders: before } = parseTenderSheet(readSheetRows(buildXls([portalRow()])));
  const { tenders: after } = parseTenderSheet(
    readSheetRows(buildXls([portalRow({ 2: "Servicio de desarrollo de software - circular modificatoria" })])),
  );
  const existing = indexTendersByKey(before.map((t) => stored(t, "id-0")));
  const plan = planTenderImport(after, existing);
  assert.equal(plan.create.length, 0);
  assert.equal(plan.unchanged, 0);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0]!.processNumber, "487-0018-LPR26");
  assert.match(plan.update[0]!.name, /circular modificatoria/);
});

test("a moved opening date counts as a change even when the text columns are identical", () => {
  const { tenders: before } = parseTenderSheet(readSheetRows(buildXls([portalRow()])));
  const { tenders: after } = parseTenderSheet(readSheetRows(buildXls([portalRow({ 4: "09/12/2026 11:00 Hrs." })])));
  const plan = planTenderImport(after, indexTendersByKey(before.map((t) => stored(t, "id-0"))));
  assert.equal(plan.update.length, 1);
});

test("the planner never mutates its inputs: the same call twice gives the same plan", () => {
  const { tenders } = parseTenderSheet(readSheetRows(buildXls([portalRow(), portalRow({ 0: "15-0005-CDI26" })])));
  const existing = indexTendersByKey([stored(tenders[0]!, "id-0")]);
  const tendersSnapshot = JSON.stringify(tenders);
  const existingSnapshot = JSON.stringify([...existing.entries()]);

  const a = planTenderImport(tenders, existing);
  const b = planTenderImport(tenders, existing);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(tenders), tendersSnapshot);
  assert.equal(JSON.stringify([...existing.entries()]), existingSnapshot);
});

test("the key is the same however the portal pads the process number", () => {
  assert.equal(tenderKey(" 487-0018-lpr26 "), tenderKey("487-0018-LPR26"));
  assert.equal(PORTAL_HEADER.length, 8);
});

test("days left is derived from now, counted in Argentina calendar days", () => {
  const opening = new Date("2026-11-27T17:00:00.000Z"); // 27/11 14:00 ART
  assert.deepEqual(tenderTiming(opening, new Date("2026-11-18T15:00:00.000Z")), { daysLeft: 9, closed: false });
  // The same instant, a day later, is a different answer: nothing is stored.
  assert.deepEqual(tenderTiming(opening, new Date("2026-11-19T15:00:00.000Z")), { daysLeft: 8, closed: false });
  // 23:30 ART on the 26th is already the 27th in UTC: the day count follows Argentina, not UTC.
  assert.equal(tenderTiming(opening, new Date("2026-11-27T02:30:00.000Z")).daysLeft, 1);
  assert.deepEqual(tenderTiming(opening, new Date("2026-11-27T12:00:00.000Z")), { daysLeft: 0, closed: false });
});

test("a tender whose opening has passed is marked closed, not dropped", () => {
  const opening = new Date("2026-11-11T13:00:00.000Z");
  const t = tenderTiming(opening, new Date("2026-11-18T15:00:00.000Z"));
  assert.equal(t.closed, true);
  assert.equal(t.daysLeft, -7);
  // Earlier the same day it is still open; once the hour passes it is closed.
  assert.equal(tenderTiming(opening, new Date("2026-11-11T12:59:00.000Z")).closed, false);
  assert.equal(tenderTiming(opening, new Date("2026-11-11T13:01:00.000Z")).closed, true);
});
