import assert from "node:assert/strict";
import { test } from "node:test";
import { type ComercialRow } from "@/lib/contactosComerciales/parse";
import { buildComercialPlan, CONTACTOS_SOURCE_KEY, prefetchKeys, type ComercialPlan, type ExistingPerson, type PlanContext } from "@/lib/contactosComerciales/plan";

const MARIEL = "b2c7ef1d-cec2-46de-8a33-13c7860bfa17";

const r = (over: Partial<ComercialRow> & { email: string }): ComercialRow => ({
  firstName: "Ana", lastName: "Test", company: "Acme Corp", lastContact: null, phones: [], nameInferred: false, ...over,
});
const ctx = (existing: ExistingPerson[] = [], aliases: [string, string][] = []): PlanContext => ({
  ownerBdId: MARIEL, existing, companyAliasByKey: new Map(aliases),
});
let n = 0;
const genId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const person = (over: Partial<ExistingPerson> & { emailNormalized: string }): ExistingPerson => ({ id: "11111111-1111-4111-8111-111111111111", phone: null, mobilePhone: null, ...over });

/** The REAL producer: what a created person looks like once it is stored. */
const asExisting = (p: ComercialPlan["creates"][number]): ExistingPerson => ({ id: p.id!, emailNormalized: p.emailNormalized ?? "", phone: p.phone ?? null, mobilePhone: p.mobilePhone ?? null });

test("a new contact is created for Mariel under the import source, with phones validated", () => {
  const plan = buildComercialPlan([r({ email: "Ana@Acme.example", phones: ["+54 9 11 5555 0100", "617-555-0102 ext 120"] })], ctx(), genId);
  assert.equal(plan.creates.length, 1);
  const p = plan.creates[0]!;
  assert.equal(p.ownerBdId, MARIEL);
  assert.equal(p.sourceKey, CONTACTOS_SOURCE_KEY);
  assert.equal(p.email, "Ana@Acme.example");
  assert.equal(p.emailNormalized, "ana@acme.example");
  assert.equal(p.status, "new");
  assert.equal(p.phone, "+54 9 11 5555 0100");
  assert.equal(p.mobilePhone, "617-555-0102");
  assert.equal(p.company, "Acme Corp");
  assert.equal(p.companyKey, "acme");
  assert.equal(plan.report.extensionsDropped, 1);
});

test("company_key goes through company_alias", () => {
  const [p] = buildComercialPlan([r({ email: "a@x.example" })], ctx([], [["acme", "acme holdings"]]), genId).creates;
  assert.equal(p!.companyKey, "acme holdings");
});

test("owner is never written as a sticky manual assignment", () => {
  const plan = buildComercialPlan([r({ email: "a@x.example", nameInferred: true, phones: ["+54 9 11 5555 0100"] })], ctx(), genId);
  for (const h of plan.historyRows) {
    assert.notEqual(h.source, "edit");
    assert.notEqual(h.property, "ownerBdId");
  }
});

test("an inferred name is recorded as a findable history marker on the created person", () => {
  const plan = buildComercialPlan([r({ email: "a@x.example", nameInferred: true }), r({ email: "b@x.example" })], ctx(), genId);
  assert.deepEqual(plan.historyRows.map((h) => [h.personId, h.property, h.newValue, h.source]), [[plan.creates[0]!.id, "nameInferred", "email", "import"]]);
  assert.equal(plan.report.inferredNamesLoaded, 1);
});

test("an existing contact with no number gets the phone filled and a history row; nothing else", () => {
  const plan = buildComercialPlan([r({ email: "ANA@acme.example", firstName: "Other", phones: ["+54 9 11 5555 0100", "+54 9 11 5555 0101"] })], ctx([person({ emailNormalized: "ana@acme.example" })]), genId);
  assert.equal(plan.creates.length, 0);
  assert.deepEqual(plan.fills, [{ personId: "11111111-1111-4111-8111-111111111111", phone: "+54 9 11 5555 0100", mobilePhone: "+54 9 11 5555 0101" }]);
  assert.deepEqual(plan.historyRows.map((h) => [h.property, h.oldValue, h.newValue, h.source]), [
    ["phone", null, "+54 9 11 5555 0100", "import"],
    ["mobilePhone", null, "+54 9 11 5555 0101", "import"],
  ]);
  assert.equal(plan.report.matched, 1);
});

test("an existing contact that already has any number is skipped and counted, never overwritten", () => {
  const rows = [r({ email: "a@x.example", phones: ["+54 9 11 5555 0100"] }), r({ email: "b@x.example", phones: ["+54 9 11 5555 0100"] }), r({ email: "c@x.example" })];
  const plan = buildComercialPlan(rows, ctx([person({ id: "a", emailNormalized: "a@x.example", phone: "123456789" }), person({ id: "b", emailNormalized: "b@x.example", mobilePhone: "987654321" }), person({ id: "c", emailNormalized: "c@x.example" })]), genId);
  assert.equal(plan.fills.length, 0);
  assert.equal(plan.report.skippedHasPhone, 2);
  assert.equal(plan.report.matched, 3);
});

test("invalid numbers store nothing and are counted", () => {
  const plan = buildComercialPlan([r({ email: "a@x.example", phones: ["12345", "+54 9 11 5555 0100"] })], ctx(), genId);
  assert.equal(plan.creates[0]!.phone, "+54 9 11 5555 0100");
  assert.equal(plan.creates[0]!.mobilePhone, null);
  assert.equal(plan.report.invalidNumbers, 1);
});

test("rows carrying a last-contact date are counted and no activity is planned", () => {
  const plan = buildComercialPlan([r({ email: "a@x.example", lastContact: "01-02-2026" }), r({ email: "b@x.example" })], ctx(), genId);
  assert.equal(plan.report.rowsWithLastContact, 1);
  assert.deepEqual(Object.keys(plan).sort(), ["creates", "fills", "historyRows", "report"]);
});

test("duplicate emails in the file collapse to the first row; ambiguous and own-company rows write nothing", () => {
  const rows = [r({ email: "a@x.example" }), r({ email: "A@x.example" }), r({ email: "dup@x.example" }), r({ email: "me@avalith.net", company: null })];
  const existing = [person({ id: "p1", emailNormalized: "dup@x.example" }), person({ id: "p2", emailNormalized: "dup@x.example" })];
  const plan = buildComercialPlan(rows, ctx(existing), genId);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.report.duplicatesInFile, 1);
  assert.equal(plan.report.ambiguous, 1);
  assert.equal(plan.report.skippedOwnCompany, 1);
});

test("re-running after the write is a no-op (idempotent)", () => {
  const rows = [r({ email: "new@x.example", phones: ["+54 9 11 5555 0100"] }), r({ email: "old@x.example", phones: ["+54 9 11 5555 0102"] })];
  const first = buildComercialPlan(rows, ctx([person({ id: "o", emailNormalized: "old@x.example" })]), genId);
  const after = [...first.creates.map(asExisting), person({ id: "o", emailNormalized: "old@x.example", phone: first.fills[0]!.phone })];
  const second = buildComercialPlan(rows, ctx(after), genId);
  assert.equal(second.creates.length, 0);
  assert.equal(second.fills.length, 0);
  assert.equal(second.historyRows.length, 0);
});

test("the planner never mutates its inputs and is repeatable", () => {
  const rows = [r({ email: "a@x.example", phones: ["+54 9 11 5555 0100"] }), r({ email: "o@x.example", phones: ["+54 9 11 5555 0102"] })];
  const existing = [person({ id: "o", emailNormalized: "o@x.example" })];
  const snapshot = JSON.stringify([rows, existing]);
  const frozen = (x: object) => Object.freeze(x);
  rows.forEach((row) => (frozen(row), frozen(row.phones)));
  existing.forEach(frozen);
  const run = () => { n = 0; return buildComercialPlan(rows, ctx(existing), genId); };
  assert.deepEqual(run(), run());
  assert.equal(JSON.stringify([rows, existing]), snapshot);
});

test("prefetchKeys uses the same key builder the planner reads with", () => {
  const { emails, rawCompanyKeys } = prefetchKeys([r({ email: " A@X.example " }), r({ email: "a@x.example" })]);
  assert.deepEqual(emails, ["a@x.example"]);
  assert.deepEqual(rawCompanyKeys, ["acme"]);
});

test("the report prints counts only and names the marker property", async () => {
  const { formatComercialReport } = await import("@/lib/contactosComerciales/report");
  const plan = buildComercialPlan([r({ email: "secret@x.example", firstName: "Zed", phones: ["+54 9 11 5555 0100"], nameInferred: true })], ctx(), genId);
  const text = formatComercialReport(plan).join("\n");
  assert.match(text, /history marker 'nameInferred'\): 1/);
  for (const leak of ["secret", "Zed", "5555"]) assert.ok(!text.includes(leak), leak);
});

test("a new contact with no name at all is created and counted", () => {
  const plan = buildComercialPlan([r({ email: "a@x.example", firstName: null, lastName: null }), r({ email: "b@x.example", firstName: null }), r({ email: "c@x.example" })], ctx(), genId);
  assert.equal(plan.creates.length, 3);
  assert.equal(plan.report.createdWithoutName, 1);
});

test("a company made only of suffixes yields a null company_key, never an empty string", () => {
  const [p] = buildComercialPlan([r({ email: "a@x.example", company: "Inc." })], ctx(), genId).creates;
  assert.equal(p!.companyKey, null);
});
