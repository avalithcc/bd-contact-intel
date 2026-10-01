/**
 * Merge carries contact_type onto the survivor, FILL-BLANK ONLY. It is a
 * classification a human assigned (BUYER-CHAMPION / INFLUENCER), so a merge
 * must not drop it. A non-empty survivor value is never overwritten: the value
 * set is closed, so a "longer value wins" rule would deterministically prefer
 * BUYER-CHAMPION over INFLUENCER, which means nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planMerge, planUnmerge, type MergePersonFields, type PlanMergeInput } from "@/lib/identity/merge";

function p(id: string, o: Partial<MergePersonFields> = {}): MergePersonFields {
  return {
    id,
    firstName: "Tito",
    lastName: "Picon",
    email: null,
    emailNormalized: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    phone: null,
    mobilePhone: null,
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
    contactType: null,
    ...o,
  };
}

function input(survivor: MergePersonFields, merged: MergePersonFields): PlanMergeInput {
  return {
    survivor,
    merged,
    survivorConnections: [],
    mergedConnections: [],
    referencesOnMerged: [],
    idMapRowsOnMerged: [],
    duplicateCandidatesInvolvingMerged: [],
    survivorPairedPersonIds: [],
    emailMessagePersonRowsOnMerged: [],
    survivorEmailMessagePersonRows: [],
    queueItemRowsOnMerged: [],
    survivorQueueItemRows: [],
  };
}

const CASES: ReadonlyArray<{ name: string; s: string | null; m: string | null; expected: string | null }> = [
  { name: "blank survivor is filled from merged", s: null, m: "INFLUENCER", expected: "INFLUENCER" },
  { name: "whitespace survivor counts as blank", s: "  ", m: "BUYER-CHAMPION", expected: "BUYER-CHAMPION" },
  { name: "non-empty survivor is never overwritten (shorter value kept)", s: "INFLUENCER", m: "BUYER-CHAMPION", expected: "INFLUENCER" },
  { name: "non-empty survivor is never overwritten (longer value kept)", s: "BUYER-CHAMPION", m: "INFLUENCER", expected: "BUYER-CHAMPION" },
  { name: "blank merged leaves survivor alone", s: "INFLUENCER", m: null, expected: "INFLUENCER" },
  { name: "both blank stays blank", s: null, m: null, expected: null },
];

for (const c of CASES) {
  test(`planMerge contactType: ${c.name}`, () => {
    const plan = planMerge(input(p("s", { contactType: c.s }), p("m", { contactType: c.m })));
    assert.equal(plan.survivorUpdate.contactType, c.expected);
  });
}

test("planMerge records a differing merged-side contactType as a property loss", () => {
  const plan = planMerge(input(p("s", { contactType: "INFLUENCER" }), p("m", { contactType: "BUYER-CHAMPION" })));
  assert.ok(plan.snapshot.propertyLosses.some((l) => l.property === "contactType" && l.value === "BUYER-CHAMPION"));
});

test("planMerge records no loss when the values agree or the survivor was blank", () => {
  const same = planMerge(input(p("s", { contactType: "INFLUENCER" }), p("m", { contactType: "INFLUENCER" })));
  const filled = planMerge(input(p("s"), p("m", { contactType: "INFLUENCER" })));
  assert.equal(same.snapshot.propertyLosses.some((l) => l.property === "contactType"), false);
  assert.equal(filled.snapshot.propertyLosses.some((l) => l.property === "contactType"), false);
});

test("a carried contactType shows up in survivorFieldChanges and unmerge reverts it", () => {
  const survivor = p("s");
  const plan = planMerge(input(survivor, p("m", { contactType: "INFLUENCER" })));
  const change = plan.snapshot.survivorFieldChanges.find((c) => c.field === "contactType");
  assert.deepEqual(change, { field: "contactType", before: null, after: "INFLUENCER" });
  const un = planUnmerge(plan.snapshot, { currentSurvivor: { ...survivor, ...plan.survivorUpdate }, currentSurvivorConnections: [] });
  assert.ok(un.survivorFieldReverts.some((r) => r.field === "contactType" && r.to === null));
});

test("planMerge does not mutate its inputs and is repeatable", () => {
  const i = input(p("s"), p("m", { contactType: "INFLUENCER" }));
  const before = JSON.stringify(i);
  const first = planMerge(i);
  const second = planMerge(i);
  assert.equal(JSON.stringify(i), before);
  assert.deepEqual(second.survivorUpdate, first.survivorUpdate);
});
