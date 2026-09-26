/**
 * Unit tests for src/lib/identity/duplicateReviewView.ts — the pure pieces
 * behind the /admin/duplicates review queue (Phase 7 task 7.2;
 * duplicate-review spec's merge path). `chooseDefaultSurvivor` decides which
 * side of a possible-duplicate pair the review UI recommends as the merge
 * survivor; `previewMergeOutcome` reuses the already-tested `planMerge`
 * (tests/unit/identityMerge.test.ts) to render the compare-panel outcome
 * before a merge is confirmed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseDefaultSurvivor, previewMergeOutcome } from "@/lib/identity/duplicateReviewView";
import type { MergeConnection, MergePersonFields } from "@/lib/identity/merge";

function person(overrides: Partial<MergePersonFields> & { id: string }): MergePersonFields {
  return {
    firstName: "Jane",
    lastName: "Doe",
    email: null,
    emailNormalized: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    company: "Acme",
    companyKey: "acme",
    companyCategory: null,
    jobTitle: null,
    roleGroup: null,
    seniority: null,
    industry: null,
    city: null,
    region: null,
    country: null,
    ownerBdId: null,
    sourceKey: null,
    ...overrides,
  };
}

function connection(overrides: Partial<MergeConnection> & { personId: string; bdId: string }): MergeConnection {
  return {
    connectedOn: null,
    legacyContactId: null,
    messageCount: 0,
    sentCount: 0,
    receivedCount: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    initiatedByMe: null,
    reciprocal: false,
    ...overrides,
  };
}

test("chooseDefaultSurvivor: side with a LinkedIn profile wins over a side without one", () => {
  const a = { id: "a", profileKey: "jane-doe", createdAt: new Date("2026-01-01") };
  const b = { id: "b", profileKey: null, createdAt: new Date("2020-01-01") };
  assert.equal(chooseDefaultSurvivor(a, [], b, []), "a");
  // Order-independent: swapping sides swaps the answer.
  assert.equal(chooseDefaultSurvivor(b, [], a, []), "b");
});

test("chooseDefaultSurvivor: both/neither have a profile — earliest connectedOn wins", () => {
  const a = { id: "a", profileKey: null, createdAt: new Date("2026-01-01") };
  const b = { id: "b", profileKey: null, createdAt: new Date("2026-01-01") };
  const aConnections = [connection({ personId: "a", bdId: "bd1", connectedOn: "5 Jun 2020" })];
  const bConnections = [connection({ personId: "b", bdId: "bd2", connectedOn: "1 Jan 2019" })];
  assert.equal(chooseDefaultSurvivor(a, aConnections, b, bConnections), "b");
});

test("chooseDefaultSurvivor: unparseable/missing connectedOn sorts last, never wins", () => {
  const a = { id: "a", profileKey: null, createdAt: new Date("2026-01-01") };
  const b = { id: "b", profileKey: null, createdAt: new Date("2020-01-01") };
  const aConnections = [connection({ personId: "a", bdId: "bd1", connectedOn: "not a date" })];
  const bConnections = [connection({ personId: "b", bdId: "bd2", connectedOn: "5 Jun 2020" })];
  assert.equal(chooseDefaultSurvivor(a, aConnections, b, bConnections), "b");
});

test("chooseDefaultSurvivor: falls back to earlier createdAt, then a stable 'a'", () => {
  const a = { id: "a", profileKey: null, createdAt: new Date("2026-01-01") };
  const b = { id: "b", profileKey: null, createdAt: new Date("2020-01-01") };
  assert.equal(chooseDefaultSurvivor(a, [], b, []), "b");

  const same = new Date("2026-01-01");
  assert.equal(
    chooseDefaultSurvivor({ id: "a", profileKey: null, createdAt: same }, [], { id: "b", profileKey: null, createdAt: same }, []),
    "a",
  );
});

test("previewMergeOutcome: renders the same field-merge outcome planMerge produces", () => {
  const survivor = person({ id: "a", firstName: "Mateo", lastName: "Fernández", jobTitle: null });
  const merged = person({ id: "b", firstName: "Mateo", lastName: "Fernandez", jobTitle: "Gerente" });

  const plan = previewMergeOutcome({
    survivor,
    merged,
    survivorConnections: [],
    mergedConnections: [],
  });

  assert.equal(plan.survivorUpdate.jobTitle, "Gerente");
  // lastName differs between the two spellings — the loser is recorded so
  // the compare panel can show it, same as a real merge would.
  assert.deepEqual(
    plan.snapshot.propertyLosses.map((l) => l.property),
    ["lastName"],
  );
});
