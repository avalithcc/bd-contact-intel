/**
 * Unit tests for src/lib/migration/catchUpPlanner.ts (task 4B.7/4B.10;
 * design.md "Catch-up (owner D4b)"; contact-migration spec "Incremental
 * catch-up run"). Pure, no DB — fixtures only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planCatchUp, type CatchUpContactRow, type CatchUpLeadRow } from "@/lib/migration/catchUpPlanner";
import { buildIdentityWriteRows, type ExistingPersonCandidate } from "@/lib/identity/resolve";

function contact(overrides: Partial<CatchUpContactRow>): CatchUpContactRow {
  return {
    id: "contact-1",
    bdId: "bd-1",
    profileKey: "linkedin.com/in/janedoe",
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    companyKey: "acme",
    position: "CTO",
    industry: null,
    connectedOn: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    ...overrides,
  };
}

function lead(overrides: Partial<CatchUpLeadRow>): CatchUpLeadRow {
  return {
    id: "lead-1",
    ownerBdId: "bd-1",
    firstName: "John",
    lastName: "Smith",
    companyDisplay: "Globex",
    companyRaw: null,
    companyKey: "globex",
    jobTitle: null,
    industryGroup: null,
    industryRaw: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    ...overrides,
  };
}

// --- contact-migration spec: "Only unmapped rows are processed" -----------

test("plans a new person for an unmapped contact and an owned unmapped lead", () => {
  const result = planCatchUp({ contacts: [contact({})], leads: [lead({})] }, []);
  assert.equal(result.plan.report.rowsRead, 2);
  assert.equal(result.plan.report.new, 2);
  assert.equal(result.leadsSkippedNoOwner, 0);
});

test("excludes owner-less leads and reports them as skipped, not planned", () => {
  const result = planCatchUp({ contacts: [], leads: [lead({ ownerBdId: null })] }, []);
  assert.equal(result.plan.report.rowsRead, 0);
  assert.equal(result.leadsSkippedNoOwner, 1);
});

test("a drifted row matching an existing person's profile key updates it in place, not as new", () => {
  const existing: ExistingPersonCandidate = {
    id: "person-1",
    profileKey: "linkedin.com/in/janedoe",
    firstName: "Jane",
    lastName: "D.",
    companyKey: "acme",
    jobTitle: null,
    industry: null,
    email: null,
    emailNormalized: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
  };
  const result = planCatchUp({ contacts: [contact({ lastName: "Doe" })], leads: [] }, [existing]);
  assert.equal(result.plan.report.autoMerged, 1);
  assert.equal(result.plan.report.new, 0);
  assert.equal(result.plan.existingUpdates.length, 1);
  assert.equal(result.plan.existingUpdates[0]?.merged.lastName, "Doe");
});

// --- contact-migration spec: "Re-run is a no-op" ---------------------------

test("applying the plan leaves zero rows unmapped, and re-running on empty input yields an empty plan", () => {
  const result = planCatchUp({ contacts: [contact({})], leads: [lead({})] }, []);
  const built = buildIdentityWriteRows(result.plan, (() => {
    let n = 0;
    return () => `generated-${++n}`;
  })());

  // Every non-skipped row gets exactly one person_id_map row (zero unmapped).
  assert.equal(built.idMap.length, 2);
  assert.ok(built.idMap.every((m) => m.personId != null));

  // Re-running the anti-join with no more unmapped rows is a no-op.
  const rerun = planCatchUp({ contacts: [], leads: [] }, []);
  assert.equal(rerun.plan.rowOutcomes.length, 0);
  assert.equal(rerun.plan.report.rowsRead, 0);
  assert.equal(rerun.leadsSkippedNoOwner, 0);
});

test("input_hash changes when a field the plan depends on changes (reflective, no hand-picked list)", () => {
  const a = planCatchUp({ contacts: [contact({})], leads: [] }, []);
  const b = planCatchUp({ contacts: [contact({ position: "VP" })], leads: [] }, []);
  assert.notEqual(a.inputHash, b.inputHash);
});
