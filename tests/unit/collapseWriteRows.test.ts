/**
 * Unit tests for src/lib/migration/collapseWriteRows.ts — the pure builder
 * that turns a collapse plan into insert-ready rows so --execute can write
 * them in batches instead of one round trip per row (the row-by-row version
 * ran for 7+ minutes inside one transaction against production).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCollapseWriteRows, chunk } from "@/lib/migration/collapseWriteRows";
import type { CollapsePlan, CollapsePersonMerged } from "@/lib/migration/collapsePlanner";

const merged: CollapsePersonMerged = {
  firstName: "Ana",
  lastName: "Pereyra",
  company: "Acme",
  companyKey: "acme",
  companyCategory: null,
  roleGroup: null,
  jobTitle: "CTO",
  industry: null,
  email: null,
  emailNormalized: null,
  emailStatus: "none",
  emailConfidence: null,
  emailSource: null,
};

function plan(): CollapsePlan {
  return {
    persons: [
      {
        planId: "plan-a",
        profileKey: "linkedin.com/in/ana",
        merged,
        ownerBdId: "bd-1",
        connections: [
          { bdId: "bd-1", legacyContactId: "c1", connectedOn: "2021-01-01" },
          { bdId: "bd-2", legacyContactId: "c2", connectedOn: null },
        ],
        legacyMappings: [
          { legacyContactId: "c1", method: "new" },
          { legacyContactId: "c2", method: "profile_key" },
        ],
      },
      {
        planId: "plan-b",
        profileKey: "linkedin.com/in/bob",
        merged: { ...merged, firstName: "Bob" },
        ownerBdId: "bd-2",
        connections: [{ bdId: "bd-2", legacyContactId: "c3", connectedOn: "2022-02-02" }],
        legacyMappings: [{ legacyContactId: "c3", method: "review" }],
      },
    ],
    ownCompanySkipped: [{ legacyContactId: "c4", bdId: "bd-1", reason: "name" }],
    reviewPairs: [{ planIdA: "plan-b", planIdB: "plan-a", reason: "name_company", matchKey: "k" }],
    report: {
      contact: { rowsRead: 4, ownCompanySkipped: 1, autoMergedByProfileKey: 1, flaggedForReview: 1, new: 1 },
      persons: { created: 2, multiBd: 1 },
      connections: { total: 3, unparseableConnectedOn: 1 },
    },
  };
}

function sequentialIds() {
  let n = 0;
  return () => `id-${++n}`;
}

test("chunk splits into fixed-size batches and keeps the remainder", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 1000), []);
});

test("chunk rejects a non-positive size", () => {
  assert.throws(() => chunk([1], 0), /positive/);
});

test("every person gets a pre-generated id that connections and id-map rows reference", () => {
  const rows = buildCollapseWriteRows(plan(), "run-1", sequentialIds());
  assert.deepEqual(
    rows.persons.map((p) => [p.id, p.profileKey, p.ownerBdId, p.migrationRunId, p.sourceKey]),
    [
      ["id-1", "linkedin.com/in/ana", "bd-1", "run-1", "linkedin_import"],
      ["id-2", "linkedin.com/in/bob", "bd-2", "run-1", "linkedin_import"],
    ],
  );
  assert.deepEqual(
    rows.connections.map((c) => [c.personId, c.bdId, c.legacyContactId, c.connectedOn]),
    [
      ["id-1", "bd-1", "c1", "2021-01-01"],
      ["id-1", "bd-2", "c2", null],
      ["id-2", "bd-2", "c3", "2022-02-02"],
    ],
  );
  assert.equal(rows.persons[1]?.firstName, "Bob");
});

test("id-map covers every legacy contact, own-company skips map to no person", () => {
  const rows = buildCollapseWriteRows(plan(), "run-1", sequentialIds());
  assert.deepEqual(
    rows.idMap.map((m) => [m.legacyTable, m.legacyId, m.personId, m.method, m.migrationRunId]),
    [
      ["contact", "c1", "id-1", "new", "run-1"],
      ["contact", "c2", "id-1", "profile_key", "run-1"],
      ["contact", "c3", "id-2", "review", "run-1"],
      ["contact", "c4", null, "skipped_own_company", "run-1"],
    ],
  );
});

test("duplicate candidates use real ids in a stable (lower, higher) order", () => {
  const rows = buildCollapseWriteRows(plan(), "run-1", sequentialIds());
  assert.deepEqual(rows.duplicateCandidates, [
    { personAId: "id-1", personBId: "id-2", reason: "name_company", matchKey: "k" },
  ]);
});

test("a review pair pointing at an unknown plan id is dropped, not written with a null id", () => {
  const p = plan();
  p.reviewPairs.push({ planIdA: "plan-a", planIdB: "plan-missing", reason: "name_company", matchKey: "x" });
  const rows = buildCollapseWriteRows(p, "run-1", sequentialIds());
  assert.equal(rows.duplicateCandidates.length, 1);
});
