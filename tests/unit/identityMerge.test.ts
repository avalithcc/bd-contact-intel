/**
 * Unit tests for src/lib/identity/merge.ts — the pure merge/unmerge planner
 * (Phase 6 tasks 6.1-6.4; design.md D6, contact-identity R7,
 * duplicate-review spec). Pure planning only; the thin DB layer
 * (./mergeDb.ts) is not unit-tested here (same convention as
 * resolve.ts/resolveDb.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planMerge,
  planUnmerge,
  type MergeConnection,
  type MergeDuplicateCandidateRow,
  type MergeIdMapRow,
  type MergePersonFields,
  type MergeReferenceRow,
  type PlanMergeInput,
} from "@/lib/identity/merge";

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
    sourceKey: "csv",
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

function baseInput(overrides: Partial<PlanMergeInput> = {}): PlanMergeInput {
  return {
    survivor: person({ id: "survivor" }),
    merged: person({ id: "merged" }),
    survivorConnections: [],
    mergedConnections: [],
    referencesOnMerged: [],
    idMapRowsOnMerged: [],
    duplicateCandidatesInvolvingMerged: [],
    survivorPairedPersonIds: [],
    ...overrides,
  };
}

test("planMerge: richer/more specific property wins, loser recorded", () => {
  const input = baseInput({
    survivor: person({ id: "survivor", jobTitle: "VP" }),
    merged: person({ id: "merged", jobTitle: "VP of Engineering" }),
  });
  const plan = planMerge(input);
  assert.equal(plan.survivorUpdate.jobTitle, "VP of Engineering");
  assert.deepEqual(
    plan.snapshot.propertyLosses.find((l) => l.property === "jobTitle"),
    { property: "jobTitle", value: "VP" },
  );
});

test("planMerge: verified email wins over probable, ties recorded as loss", () => {
  const input = baseInput({
    survivor: person({ id: "survivor", email: "a@x.com", emailNormalized: "a@x.com", emailStatus: "probable" }),
    merged: person({ id: "merged", email: "b@x.com", emailNormalized: "b@x.com", emailStatus: "verified" }),
  });
  const plan = planMerge(input);
  assert.equal(plan.survivorUpdate.email, "b@x.com");
  assert.equal(plan.survivorUpdate.emailStatus, "verified");
  assert.deepEqual(
    plan.snapshot.propertyLosses.find((l) => l.property === "email"),
    { property: "email", value: "a@x.com" },
  );
});

test("planMerge: owner is the earliest connector across both persons", () => {
  const input = baseInput({
    survivor: person({ id: "survivor", ownerBdId: "bd-old" }),
    merged: person({ id: "merged", ownerBdId: "bd-lead" }),
    survivorConnections: [connection({ personId: "survivor", bdId: "bd-old", connectedOn: "10 Mar 2022" })],
    mergedConnections: [connection({ personId: "merged", bdId: "bd-early", connectedOn: "1 Jan 2020" })],
  });
  const plan = planMerge(input);
  assert.equal(plan.ownerBdId, "bd-early");
});

test("planMerge: no parseable connection falls back to the lead's existing owner", () => {
  const input = baseInput({
    survivor: person({ id: "survivor", ownerBdId: null }),
    merged: person({ id: "merged", ownerBdId: "bd-lead" }),
  });
  const plan = planMerge(input);
  assert.equal(plan.ownerBdId, "bd-lead");
});

test("planMerge: connections unique to merged are repointed, conflicting ones are dropped", () => {
  const input = baseInput({
    survivorConnections: [connection({ personId: "survivor", bdId: "bd-1" })],
    mergedConnections: [
      connection({ personId: "merged", bdId: "bd-1", messageCount: 5 }),
      connection({ personId: "merged", bdId: "bd-2", messageCount: 2 }),
    ],
  });
  const plan = planMerge(input);
  assert.equal(plan.connectionsToRepoint.length, 1);
  assert.equal(plan.connectionsToRepoint[0].bdId, "bd-2");
  assert.equal(plan.connectionsToRepoint[0].personId, "survivor");
  assert.equal(plan.connectionsToDrop.length, 1);
  assert.equal(plan.connectionsToDrop[0].bdId, "bd-1");
});

test("planMerge: references and id-map rows on merged are all repointed", () => {
  const references: MergeReferenceRow[] = [
    { table: "activity", id: "act-1" },
    { table: "task", id: "task-1" },
  ];
  const idMapRows: MergeIdMapRow[] = [{ legacyTable: "lead", legacyId: "lead-1" }];
  const plan = planMerge(baseInput({ referencesOnMerged: references, idMapRowsOnMerged: idMapRows }));
  assert.deepEqual(plan.referencesToRepoint, references);
  assert.deepEqual(plan.idMapRowsToRepoint, idMapRows);
});

test("planMerge: the (survivor, merged) candidate pair is marked merged, not repointed", () => {
  const candidates: MergeDuplicateCandidateRow[] = [
    { id: "cand-1", personAId: "merged", personBId: "survivor", status: "open" },
  ];
  const plan = planMerge(baseInput({ duplicateCandidatesInvolvingMerged: candidates }));
  assert.equal(plan.duplicateCandidateToMarkMerged, "cand-1");
  assert.equal(plan.duplicateCandidatesToRepoint.length, 0);
});

test("planMerge: a pair with a third person repoints to (survivor, third)", () => {
  const candidates: MergeDuplicateCandidateRow[] = [
    { id: "cand-2", personAId: "merged", personBId: "third", status: "open" },
  ];
  const plan = planMerge(baseInput({ duplicateCandidatesInvolvingMerged: candidates }));
  assert.equal(plan.duplicateCandidatesToRepoint.length, 1);
  const [a, b] = ["survivor", "third"].sort();
  assert.deepEqual(plan.duplicateCandidatesToRepoint[0], { id: "cand-2", personAId: a, personBId: b });
});

test("planMerge: a repoint that collides with an existing survivor pair is dropped instead", () => {
  const candidates: MergeDuplicateCandidateRow[] = [
    { id: "cand-3", personAId: "merged", personBId: "third", status: "open" },
  ];
  const plan = planMerge(
    baseInput({ duplicateCandidatesInvolvingMerged: candidates, survivorPairedPersonIds: ["third"] }),
  );
  assert.equal(plan.duplicateCandidatesToRepoint.length, 0);
  assert.deepEqual(plan.duplicateCandidatesToDrop, ["cand-3"]);
});

test("6.4: false merge then unmerge restores both original Contacts exactly", () => {
  const survivor = person({ id: "survivor", jobTitle: "VP", ownerBdId: "bd-old" });
  const merged = person({ id: "merged", jobTitle: "VP of Engineering", ownerBdId: "bd-lead" });
  const survivorConnections = [connection({ personId: "survivor", bdId: "bd-old", connectedOn: "10 Mar 2022" })];
  const mergedConnections = [
    connection({ personId: "merged", bdId: "bd-early", connectedOn: "1 Jan 2020", messageCount: 3 }),
  ];
  const references: MergeReferenceRow[] = [{ table: "activity", id: "act-1" }];
  const idMapRows: MergeIdMapRow[] = [{ legacyTable: "lead", legacyId: "lead-1" }];
  const candidates: MergeDuplicateCandidateRow[] = [
    { id: "cand-1", personAId: "merged", personBId: "survivor", status: "open" },
  ];

  const input = baseInput({
    survivor,
    merged,
    survivorConnections,
    mergedConnections,
    referencesOnMerged: references,
    idMapRowsOnMerged: idMapRows,
    duplicateCandidatesInvolvingMerged: candidates,
  });

  const mergePlan = planMerge(input);
  const unmergePlan = planUnmerge(mergePlan.snapshot);

  // The original rows are recoverable byte-for-byte from the snapshot.
  assert.deepEqual(unmergePlan.survivorRestore, survivor);
  assert.deepEqual(unmergePlan.mergedRestore, merged);
  assert.deepEqual(unmergePlan.mergedConnectionsRestore, mergedConnections);
  assert.deepEqual(unmergePlan.survivorBdIdsToRemove, ["bd-early"]);
  assert.deepEqual(unmergePlan.referencesToRepointBack, references);
  assert.deepEqual(unmergePlan.idMapRowsToRepointBack, idMapRows);
  assert.deepEqual(unmergePlan.mergedPairCandidateToReopen, { id: "cand-1", originalStatus: "open" });
});
