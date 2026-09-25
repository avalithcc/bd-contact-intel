/**
 * Unit tests for src/lib/migration/foldWriteRows.ts — the pure builder that
 * turns a fold-leads plan into insert/update-ready rows (task 4.3), plus the
 * task 4.5 fixture-level check: every legacy lead id resolves via
 * `person_id_map`, and simulated `activity`/`task`/`signal` rows re-pointed
 * through that map never keep a null `person_id` unless the lead itself was
 * skipped as own-company.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFoldWriteRows } from "@/lib/migration/foldWriteRows";
import { planFoldLeads, type FoldExistingPerson, type FoldLeadRow } from "@/lib/migration/foldPlanner";

function existingPerson(overrides: Partial<FoldExistingPerson> = {}): FoldExistingPerson {
  return {
    id: "person-1",
    profileKey: "linkedin.com/in/ana",
    firstName: "Ana",
    lastName: "Pereyra",
    companyKey: "acme",
    email: "ana@acme.com",
    emailNormalized: "ana@acme.com",
    emailStatus: "verified",
    emailConfidence: 90,
    emailSource: "linkedin_export",
    jobTitle: "CTO",
    industry: null,
    ...overrides,
  };
}

function lead(overrides: Partial<FoldLeadRow> = {}): FoldLeadRow {
  return {
    id: "lead-1",
    ownerBdId: "bd-1",
    firstName: "Ana",
    lastName: "Pereyra",
    company: "Acme",
    companyKey: "acme",
    jobTitle: "CTO",
    industry: null,
    email: "ana@acme.com",
    emailStatus: "verified",
    emailConfidence: 90,
    emailSource: "hunter",
    sourceKey: "fi-arg-2026",
    status: "new",
    updatedByBdId: null,
    updatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function sequentialIds() {
  let n = 0;
  return () => `new-id-${++n}`;
}

test("a lead auto-merged by verified email produces an id-map row pointing at the EXISTING person, no new person row", () => {
  const plan = planFoldLeads([existingPerson()], [lead()]);
  const rows = buildFoldWriteRows(plan, "run-1", sequentialIds());

  assert.equal(rows.persons.length, 0, "no new person should be created for an auto-merge");
  assert.deepEqual(rows.idMap, [
    { legacyTable: "lead", legacyId: "lead-1", personId: "person-1", method: "verified_email", migrationRunId: "run-1" },
  ]);
  assert.equal(rows.personUpdates.length, 1);
  assert.equal(rows.personUpdates[0]?.id, "person-1");
});

test("an unmatched lead becomes a new person with a pre-generated id, and the id-map row references it", () => {
  const plan = planFoldLeads([], [lead({ id: "lead-2", email: null, emailStatus: "none" })]);
  const rows = buildFoldWriteRows(plan, "run-1", sequentialIds());

  assert.equal(rows.persons.length, 1);
  const newPersonId = rows.persons[0]?.id;
  assert.equal(newPersonId, "new-id-1");
  assert.equal(rows.persons[0]?.ownerBdId, "bd-1");
  assert.equal(rows.persons[0]?.sourceKey, "fi-arg-2026");
  assert.deepEqual(rows.idMap, [
    { legacyTable: "lead", legacyId: "lead-2", personId: newPersonId, method: "new", migrationRunId: "run-1" },
  ]);
});

test("a name+company review match creates a duplicate_candidate referencing the new person's REAL generated id, not the plan id", () => {
  const plan = planFoldLeads(
    [existingPerson({ email: null, emailNormalized: null, emailStatus: "none" })],
    [lead({ id: "lead-3", email: null, emailStatus: "none" })],
  );
  const rows = buildFoldWriteRows(plan, "run-1", sequentialIds());

  assert.equal(rows.duplicateCandidates.length, 1);
  const candidate = rows.duplicateCandidates[0]!;
  assert.ok(![candidate.personAId, candidate.personBId].includes("np1"), "no raw plan id should leak into the write rows");
  assert.ok([candidate.personAId, candidate.personBId].includes("person-1"));
  assert.ok([candidate.personAId, candidate.personBId].includes("new-id-1"));
});

test("task 4.5 — every legacy lead id resolves via person_id_map, and reference rows re-pointed through it never keep a null person_id unless the lead was skipped as own-company", () => {
  const leads = [
    lead({ id: "lead-auto", email: "ana@acme.com", emailStatus: "verified" }),
    lead({ id: "lead-new", email: null, emailStatus: "none", firstName: "Carla", lastName: "Diaz", companyKey: "other" }),
  ];
  const plan = planFoldLeads([existingPerson()], leads);
  const rows = buildFoldWriteRows(plan, "run-1", sequentialIds());

  // Every lead in the fixture must appear exactly once in the id-map.
  const mappedLeadIds = new Set(rows.idMap.map((m) => m.legacyId));
  for (const l of leads) assert.ok(mappedLeadIds.has(l.id), `lead ${l.id} missing from person_id_map`);

  // Simulate reference-table re-pointing (activity/task/signal), the same
  // join scripts/unify-contacts.ts performs via SQL: legacyId -> personId.
  const idMapByLeadId = new Map(rows.idMap.map((m) => [m.legacyId, m.personId]));
  const referenceRows = leads.map((l) => ({ leadId: l.id, personId: null as string | null }));
  for (const ref of referenceRows) {
    ref.personId = idMapByLeadId.get(ref.leadId) ?? null;
  }

  for (const ref of referenceRows) {
    const mapping = rows.idMap.find((m) => m.legacyId === ref.leadId)!;
    if (mapping.method === "skipped_own_company") {
      assert.equal(ref.personId, null);
    } else {
      assert.notEqual(ref.personId, null, `reference row for lead ${ref.leadId} was left without person_id`);
    }
  }
});

// --- task 4.2: status_backfill activity rows ---------------------------

test("a status_backfill row resolves a plan id to the new person's REAL generated id, not the raw plan id", () => {
  const plan = planFoldLeads(
    [],
    [
      lead({
        id: "lead-new",
        email: null,
        emailStatus: "none",
        status: "meeting",
        updatedByBdId: "bd-2",
        updatedAt: new Date("2026-03-01T00:00:00Z"),
      }),
    ],
  );
  const rows = buildFoldWriteRows(plan, "run-1", sequentialIds());

  assert.equal(rows.activities.length, 1);
  const [row] = rows.activities;
  assert.equal(row.personId, "new-id-1");
  assert.equal(row.actorBdId, null);
  assert.equal(row.type, "status_backfill");
  assert.deepEqual(row.metadata, {
    status: "meeting",
    originalEditorBdId: "bd-2",
    originalAt: "2026-03-01T00:00:00.000Z",
  });
});

test("no status_backfill rows are built when no lead needs one", () => {
  const plan = planFoldLeads([existingPerson()], [lead()]);
  const rows = buildFoldWriteRows(plan, "run-1", sequentialIds());

  assert.equal(rows.activities.length, 0);
});
