/** planMerge's owner decision under the last-worked rule and the sticky manual owner. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planMerge, type MergeConnection, type MergePersonFields, type PlanMergeInput } from "@/lib/identity/merge";

function person(id: string, ownerBdId: string | null): MergePersonFields {
  return {
    id, firstName: "Jane", lastName: "Doe", email: null, emailNormalized: null, emailStatus: "none",
    emailConfidence: null, emailSource: null, phone: null, mobilePhone: null, company: "Acme", companyKey: "acme",
    companyCategory: null, jobTitle: null, roleGroup: null, seniority: null, industry: null, city: null,
    region: null, country: null, ownerBdId, sourceKey: "csv", contactType: null,
  };
}

function conn(personId: string, bdId: string, connectedOn: string, lastMessageAt: Date | null): MergeConnection {
  return {
    personId, bdId, connectedOn, legacyContactId: null, messageCount: 0, sentCount: 0, receivedCount: 0,
    firstMessageAt: null, lastMessageAt, initiatedByMe: null, reciprocal: false,
  };
}

function input(overrides: Partial<PlanMergeInput>): PlanMergeInput {
  return {
    survivor: person("s", "bd-old"), merged: person("m", "bd-lead"), survivorConnections: [], mergedConnections: [],
    referencesOnMerged: [], idMapRowsOnMerged: [], duplicateCandidatesInvolvingMerged: [], survivorPairedPersonIds: [],
    emailMessagePersonRowsOnMerged: [], survivorEmailMessagePersonRows: [], queueItemRowsOnMerged: [], survivorQueueItemRows: [],
    ...overrides,
  };
}

const early = conn("m", "bd-early", "1 Jan 2020", null);
const lateWriter = conn("s", "bd-late", "1 Jan 2023", new Date("2025-01-01T00:00:00Z"));

test("planMerge: the BD who worked the contact last owns it, not the earliest connector", () => {
  const plan = planMerge(input({ survivorConnections: [lateWriter], mergedConnections: [early] }));
  assert.equal(plan.ownerBdId, "bd-late");
});

test("planMerge: activity touches count toward the last-worked owner", () => {
  const plan = planMerge(
    input({ survivorConnections: [lateWriter], mergedConnections: [early], ownerTouches: [{ bdId: "bd-early", at: new Date("2025-06-01T00:00:00Z") }] }),
  );
  assert.equal(plan.ownerBdId, "bd-early");
});

test("planMerge: nobody touched it, the earliest connector still wins", () => {
  const untouched = conn("s", "bd-late", "1 Jan 2023", null);
  const plan = planMerge(input({ survivorConnections: [untouched], mergedConnections: [early] }));
  assert.equal(plan.ownerBdId, "bd-early");
});

test("planMerge: a manual owner on the survivor is never overridden", () => {
  const plan = planMerge(input({ survivorConnections: [lateWriter], mergedConnections: [early], survivorHasManualOwner: true }));
  assert.equal(plan.ownerBdId, "bd-old");
});

test("planMerge: a manual owner on the merged person carries over when the survivor has none", () => {
  const plan = planMerge(input({ survivorConnections: [lateWriter], mergedConnections: [early], mergedHasManualOwner: true }));
  assert.equal(plan.ownerBdId, "bd-lead");
});

test("planMerge: owner decision is repeatable and does not mutate its input", () => {
  const data = input({ survivorConnections: [lateWriter], mergedConnections: [early], ownerTouches: [{ bdId: "bd-early", at: new Date("2024-01-01T00:00:00Z") }] });
  const before = JSON.stringify(data);
  assert.equal(planMerge(data).ownerBdId, planMerge(data).ownerBdId);
  assert.equal(JSON.stringify(data), before);
});
