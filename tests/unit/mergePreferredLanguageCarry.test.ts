/**
 * Merge carries person.preferred_language onto the survivor, FILL-BLANK ONLY: it is a statement a BD made about the person
 * ("write to them in Spanish"), so a merge must not drop it, and a value the survivor already holds is never replaced.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planMerge, planUnmerge, type MergePersonFields, type PlanMergeInput } from "@/lib/identity/merge";

function p(id: string, preferredLanguage: string | null = null): MergePersonFields {
  return {
    id, firstName: "Tito", lastName: "Picon", email: null, emailNormalized: null, emailStatus: "none", emailConfidence: null, emailSource: null,
    phone: null, mobilePhone: null, company: "Acme", companyKey: "acme", companyCategory: null, jobTitle: null, roleGroup: null, seniority: null,
    industry: null, city: null, region: null, country: null, ownerBdId: null, sourceKey: null, contactType: null, preferredLanguage,
  };
}

function input(survivor: MergePersonFields, merged: MergePersonFields): PlanMergeInput {
  return {
    survivor, merged, survivorConnections: [], mergedConnections: [], referencesOnMerged: [], idMapRowsOnMerged: [], duplicateCandidatesInvolvingMerged: [],
    survivorPairedPersonIds: [], emailMessagePersonRowsOnMerged: [], survivorEmailMessagePersonRows: [], queueItemRowsOnMerged: [], survivorQueueItemRows: [],
  };
}

const CASES: ReadonlyArray<{ name: string; s: string | null; m: string | null; expected: string | null }> = [
  { name: "blank survivor is filled from merged", s: null, m: "es", expected: "es" },
  { name: "a survivor value is never overwritten", s: "en", m: "es", expected: "en" },
  { name: "blank merged leaves the survivor alone", s: "es", m: null, expected: "es" },
  { name: "both blank stays blank", s: null, m: null, expected: null },
];

for (const c of CASES) {
  test(`planMerge preferredLanguage: ${c.name}`, () => {
    assert.equal(planMerge(input(p("s", c.s), p("m", c.m))).survivorUpdate.preferredLanguage, c.expected);
  });
}

test("a differing merged-side preferredLanguage is kept as a property loss; an agreeing or filled one is not", () => {
  const differing = planMerge(input(p("s", "en"), p("m", "es")));
  assert.ok(differing.snapshot.propertyLosses.some((l) => l.property === "preferredLanguage" && l.value === "es"));
  const filled = planMerge(input(p("s"), p("m", "es")));
  assert.equal(filled.snapshot.propertyLosses.some((l) => l.property === "preferredLanguage"), false);
});

test("a carried preferredLanguage is reverted by unmerge and the planner is repeatable", () => {
  const survivor = p("s");
  const i = input(survivor, p("m", "es"));
  const before = JSON.stringify(i);
  const plan = planMerge(i);
  assert.deepEqual(planMerge(i).survivorUpdate, plan.survivorUpdate);
  assert.equal(JSON.stringify(i), before);
  assert.deepEqual(plan.snapshot.survivorFieldChanges.find((c) => c.field === "preferredLanguage"), { field: "preferredLanguage", before: null, after: "es" });
  const un = planUnmerge(plan.snapshot, { currentSurvivor: { ...survivor, ...plan.survivorUpdate }, currentSurvivorConnections: [] });
  assert.ok(un.survivorFieldReverts.some((r) => r.field === "preferredLanguage" && r.to === null));
});
