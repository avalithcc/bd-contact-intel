/**
 * Unit tests for src/lib/dff2026/planImport.ts. Pure, no DB — run with:
 * npx tsx --test tests/unit/dff2026PlanImport.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { classifyPosition } from "@/lib/roleGroups";
import type { AttendeeRecord } from "@/lib/dff2026/buildAttendeeRecords";
import {
  buildImportPlan,
  selectDffAuditRow,
  type DffAuditRow,
  type ExistingPersonForImport,
  type ImportContext,
} from "@/lib/dff2026/planImport";

const MARIEL = "mariel-bd-id";

function record(overrides: Partial<AttendeeRecord> = {}): AttendeeRecord {
  return {
    firstName: "Juan",
    lastName: "Perez",
    jobTitle: "Manager",
    mobilePhoneRaw: "1122334455",
    companyRaw: "Acme Corp",
    email: "juan.perez@example.com",
    emailNormalized: "juan.perez@example.com",
    ...overrides,
  };
}

function ctx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    marielBdId: MARIEL,
    bdNamesById: new Map(),
    existingPersonsByEmail: new Map(),
    companyAliasByKey: new Map(),
    existingCompaniesByKey: new Map(),
    ...overrides,
  };
}

function existingPerson(overrides: Partial<ExistingPersonForImport> = {}): ExistingPersonForImport {
  return {
    id: "p1",
    firstName: null,
    lastName: null,
    jobTitle: null,
    mobilePhone: null,
    company: null,
    companyKey: null,
    ownerBdId: null,
    email: "juan.perez@example.com",
    emailNormalized: "juan.perez@example.com",
    emailStatus: "probable",
    emailConfidence: null,
    emailSource: "old-source",
    ...overrides,
  };
}

function genIdSeq(prefix = "id"): () => string {
  let i = 0;
  return () => `${prefix}-${i++}`;
}

test("creates a new person owned by Mariel, status new, sourceKey dff-2026", () => {
  const plan = buildImportPlan([record()], ctx(), genIdSeq());
  assert.equal(plan.creates.length, 1);
  assert.deepEqual(plan.creates[0], {
    id: "id-0",
    firstName: "Juan",
    lastName: "Perez",
    email: "juan.perez@example.com",
    emailNormalized: "juan.perez@example.com",
    emailStatus: "probable",
    emailSource: "dff-2026",
    mobilePhone: "1122334455",
    company: "Acme Corp",
    companyKey: normalizeCompanyKey("Acme Corp"),
    jobTitle: "Manager",
    roleGroup: classifyPosition("Manager"),
    ownerBdId: MARIEL,
    status: "new",
    sourceKey: "dff-2026",
  });
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.report.created, 1);
});

test("existing person: fills only currently-empty fields, never overwrites a non-empty one", () => {
  const existing = existingPerson({ lastName: "Perez" }); // non-empty already
  const plan = buildImportPlan(
    [record({ firstName: "Juan", lastName: "Gomez" /* would collide, must be ignored */ })],
    ctx({ existingPersonsByEmail: new Map([["juan.perez@example.com", existing]]) }),
  );
  const update = plan.updates[0]!;
  assert.equal(update.personUpdate.firstName, "Juan"); // was empty -> filled
  assert.equal(update.personUpdate.lastName, undefined); // was "Perez" -> untouched
  assert.equal(update.personUpdate.jobTitle, "Manager");
  assert.equal(update.personUpdate.roleGroup, classifyPosition("Manager"));
  assert.equal(update.personUpdate.mobilePhone, "1122334455");
  assert.equal(update.personUpdate.companyKey, normalizeCompanyKey("Acme Corp"));
  assert.equal(update.personUpdate.ownerBdId, MARIEL); // was unowned
  assert.equal(plan.report.existingNewlyOwned, 1);
  assert.equal(plan.report.existingReassignedFromOtherBd.length, 0);
});

test("reassigns an already-owned person's owner to Mariel and names the previous owner", () => {
  const existing = existingPerson({ ownerBdId: "bd-cristian" });
  const plan = buildImportPlan(
    [record()],
    ctx({
      existingPersonsByEmail: new Map([["juan.perez@example.com", existing]]),
      bdNamesById: new Map([["bd-cristian", "Cristian Civita"]]),
    }),
  );
  const update = plan.updates[0]!;
  assert.equal(update.personUpdate.ownerBdId, MARIEL);
  assert.equal(update.reassignedFromBdId, "bd-cristian");
  assert.equal(update.reassignedFromName, "Cristian Civita");
  assert.deepEqual(plan.report.existingReassignedFromOtherBd, [{ personId: "p1", previousOwnerName: "Cristian Civita" }]);
  assert.equal(plan.report.existingNewlyOwned, 0);
});

test("no owner change when the existing owner is already Mariel", () => {
  const existing = existingPerson({ ownerBdId: MARIEL });
  const plan = buildImportPlan([record()], ctx({ existingPersonsByEmail: new Map([["juan.perez@example.com", existing]]) }));
  const update = plan.updates[0]!;
  assert.equal(update.personUpdate.ownerBdId, undefined);
  assert.equal(update.reassignedFromBdId, null);
});

test("company: an alias redirects to its canonical existing company (matched, not created)", () => {
  const canonicalKey = "acme";
  const plan = buildImportPlan(
    [record({ companyRaw: "Acme Corp" })],
    ctx({
      companyAliasByKey: new Map([[normalizeCompanyKey("Acme Corp"), canonicalKey]]),
      existingCompaniesByKey: new Map([[canonicalKey, { companyKey: canonicalKey, displayName: "Acme Inc" }]]),
    }),
  );
  assert.equal(plan.creates[0]!.companyKey, canonicalKey);
  assert.equal(plan.creates[0]!.company, "Acme Corp"); // raw name, not the canonical displayName
  assert.equal(plan.companiesToCreate.length, 0);
  assert.equal(plan.report.companiesMatched, 1);
  assert.equal(plan.report.companiesCreated, 0);
});

test("company: an ALL-CAPS raw name still matches an existing company by key (case-insensitive) and keeps its display name, but a brand-new company is created with the raw ALL-CAPS text (a deliberate decision, not title-cased)", () => {
  const canonicalKey = normalizeCompanyKey("Accenture"); // == normalizeCompanyKey("ACCENTURE")
  const plan = buildImportPlan(
    [
      record({ companyRaw: "ACCENTURE", email: "a@x.com", emailNormalized: "a@x.com" }),
      record({ companyRaw: "360 ENERGY SA", email: "b@x.com", emailNormalized: "b@x.com" }),
    ],
    ctx({ existingCompaniesByKey: new Map([[canonicalKey, { companyKey: canonicalKey, displayName: "Accenture" }]]) }),
  );
  const accenturePerson = plan.creates.find((c) => c.email === "a@x.com")!;
  assert.equal(accenturePerson.companyKey, canonicalKey); // matched despite the case difference
  assert.equal(accenturePerson.company, "ACCENTURE"); // person.company keeps the raw text regardless
  assert.equal(plan.report.companiesMatched, 1);
  assert.deepEqual(plan.companiesToCreate, [{ companyKey: normalizeCompanyKey("360 ENERGY SA"), displayName: "360 ENERGY SA" }]); // new company: stored as-is, not title-cased
});

test("company: no match queues one new company row, deduped across rows", () => {
  const plan = buildImportPlan(
    [record({ companyRaw: "Brand New Co", email: "a@x.com", emailNormalized: "a@x.com" }), record({ companyRaw: "Brand New Co", email: "b@x.com", emailNormalized: "b@x.com" })],
    ctx(),
  );
  assert.deepEqual(plan.companiesToCreate, [{ companyKey: normalizeCompanyKey("Brand New Co"), displayName: "Brand New Co" }]);
  assert.equal(plan.report.companiesCreated, 1);
  assert.equal(plan.report.companiesMatched, 0);
});

// Review fix (orphan company rows, 2026-09-30): an existing person whose
// companyKey is already set can never have it filled (planHubSpotRefill's
// fillField only ever fills an empty field) — resolving/queuing a company
// for them anyway would create a permanent 0-contact "ghost" row nobody
// links to, and would overstate `companiesCreated` in the dry-run report.
test("existing person with an already-set companyKey: no company is queued for a different EMPRESA, and companyKey is left untouched", () => {
  const existing = existingPerson({ companyKey: "already-linked-co", company: "Already Linked Co" });
  const plan = buildImportPlan(
    [record({ companyRaw: "Some Brand New Company" })],
    ctx({ existingPersonsByEmail: new Map([["juan.perez@example.com", existing]]) }),
  );
  const update = plan.updates[0]!;
  assert.equal(update.personUpdate.companyKey, undefined);
  assert.equal(update.personUpdate.company, undefined);
  assert.equal(plan.companiesToCreate.length, 0);
  assert.equal(plan.report.companiesCreated, 0);
  assert.equal(plan.report.companiesMatched, 0);
});

test("phone: rejects a too-short value, writes a valid one raw/unformatted, tracks digit-length histogram", () => {
  const plan = buildImportPlan(
    [
      record({ mobilePhoneRaw: "123", email: "a@x.com", emailNormalized: "a@x.com" }),
      record({ mobilePhoneRaw: "1122334455", email: "b@x.com", emailNormalized: "b@x.com" }),
    ],
    ctx(),
  );
  assert.equal(plan.report.phonesWritten, 1);
  assert.equal(plan.report.phonesRejected.length, 1);
  assert.equal(plan.report.phonesRejected[0]!.reason, "too_few_digits");
  assert.deepEqual(plan.report.phoneDigitLengthHistogram, { 3: 1, 10: 1 });
  const rejected = plan.creates.find((c) => c.email === "a@x.com")!;
  const accepted = plan.creates.find((c) => c.email === "b@x.com")!;
  assert.equal(rejected.mobilePhone, null);
  assert.equal(accepted.mobilePhone, "1122334455"); // stored raw, never reformatted
});

test("every record is imported unconditionally — no scope/attendance filtering", () => {
  const records = [record({ email: "a@x.com", emailNormalized: "a@x.com" }), record({ email: "b@x.com", emailNormalized: "b@x.com" })];
  const plan = buildImportPlan(records, ctx());
  assert.equal(plan.creates.length, 2);
  assert.equal(plan.report.rowsProcessed, 2);
});

test("pure planner: never mutates its inputs, and calling it twice with the same input gives the same result", () => {
  const records = [record({ email: "a@x.com", emailNormalized: "a@x.com" }), record({ email: "b@x.com", emailNormalized: "b@x.com" })];
  const existing = existingPerson({ email: "b@x.com", emailNormalized: "b@x.com", ownerBdId: "bd-other" });
  const context = ctx({ existingPersonsByEmail: new Map([["b@x.com", existing]]), bdNamesById: new Map([["bd-other", "Other BD"]]) });

  const recordsSnapshot = JSON.parse(JSON.stringify(records));
  const existingSnapshot = JSON.parse(JSON.stringify([...context.existingPersonsByEmail.entries()]));

  // A fixed clock, not `new Date()` — `buildExistingUpdate`'s `updatedAt`
  // fill is otherwise wall-clock-dependent, which would make this exact
  // "call it twice" comparison flaky by a few milliseconds.
  const fixedNow = () => new Date("2026-09-30T12:00:00.000Z");
  const planA = buildImportPlan(records, context, genIdSeq(), fixedNow);
  const planB = buildImportPlan(records, context, genIdSeq(), fixedNow);

  assert.deepEqual(planA, planB);
  assert.deepEqual(JSON.parse(JSON.stringify(records)), recordsSnapshot);
  assert.deepEqual(JSON.parse(JSON.stringify([...context.existingPersonsByEmail.entries()])), existingSnapshot);
});

// --- selectDffAuditRow (revert selection) -----------------------------------

function auditRow(overrides: Partial<DffAuditRow> = {}): DffAuditRow {
  return {
    id: "audit-1",
    at: new Date("2026-09-30T00:00:00.000Z"),
    actorBdId: "actor-1",
    metadata: { sourceKey: "dff-2026", createdPersonIds: [], updatedHistoryRows: [], companiesCreated: [] },
    ...overrides,
  };
}

test("selectDffAuditRow: none when no rows exist", () => {
  assert.deepEqual(selectDffAuditRow([], null), { kind: "none" });
});

test("selectDffAuditRow: auto-selects the only row", () => {
  const row = auditRow();
  assert.deepEqual(selectDffAuditRow([row], null), { kind: "selected", row });
});

test("selectDffAuditRow: refuses to guess among several rows without --audit-id", () => {
  const rows = [auditRow({ id: "a" }), auditRow({ id: "b" })];
  assert.deepEqual(selectDffAuditRow(rows, null), { kind: "ambiguous", candidates: rows });
});

test("selectDffAuditRow: an explicit --audit-id selects exactly that row, or reports not_found", () => {
  const rows = [auditRow({ id: "a" }), auditRow({ id: "b" })];
  assert.deepEqual(selectDffAuditRow(rows, "b"), { kind: "selected", row: rows[1] });
  assert.deepEqual(selectDffAuditRow(rows, "c"), { kind: "not_found", requestedAuditId: "c", candidates: rows });
});
