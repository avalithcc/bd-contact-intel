/**
 * Merge carries phone/mobile_phone onto the survivor, FILL-BLANK ONLY: a
 * non-empty survivor value is never overwritten (unlike the "longer value
 * wins" rule other tracked fields use, a phone's length says nothing about
 * which number the BD wants kept). Real messy values from production.
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

const FILL_CASES: ReadonlyArray<{ name: string; s: Partial<MergePersonFields>; m: Partial<MergePersonFields>; phone: string | null; mobile: string | null }> = [
  { name: "Tito: both stranded on merged", s: {}, m: { phone: "+54 (11) 4118 8080", mobilePhone: "+54 (911) 6213 0024" }, phone: "+54 (11) 4118 8080", mobile: "+54 (911) 6213 0024" },
  { name: "Ortega: phone only", s: {}, m: { phone: "+54 9 11 4590-2294" }, phone: "+54 9 11 4590-2294", mobile: null },
  { name: "Uauy: mobile only", s: {}, m: { mobilePhone: "994489460" }, phone: null, mobile: "994489460" },
  { name: "whitespace survivor counts as blank", s: { phone: "  " }, m: { phone: "+1 (954) 837-6436" }, phone: "+1 (954) 837-6436", mobile: null },
  { name: "survivor non-empty is never overwritten", s: { phone: "+56 2 2938 0805" }, m: { phone: "+56 2 2938 9999", mobilePhone: "+56 9 1111 2222" }, phone: "+56 2 2938 0805", mobile: "+56 9 1111 2222" },
  { name: "both blank stays blank", s: {}, m: {}, phone: null, mobile: null },
];

for (const c of FILL_CASES) {
  test(`planMerge phones: ${c.name}`, () => {
    const plan = planMerge(input(p("s", c.s), p("m", c.m)));
    assert.equal(plan.survivorUpdate.phone, c.phone);
    assert.equal(plan.survivorUpdate.mobilePhone, c.mobile);
  });
}

test("planMerge records a differing merged-side phone as a property loss", () => {
  const plan = planMerge(input(p("s", { phone: "+56 2 2938 0805" }), p("m", { phone: "+56 2 2938 9999" })));
  assert.ok(plan.snapshot.propertyLosses.some((l) => l.property === "phone" && l.value === "+56 2 2938 9999"));
});

test("a carried phone shows up in survivorFieldChanges and unmerge reverts it", () => {
  const survivor = p("s");
  const plan = planMerge(input(survivor, p("m", { phone: "+54 9 11 4590-2294" })));
  const change = plan.snapshot.survivorFieldChanges.find((c) => c.field === "phone");
  assert.deepEqual(change, { field: "phone", before: null, after: "+54 9 11 4590-2294" });
  const un = planUnmerge(plan.snapshot, { currentSurvivor: { ...survivor, ...plan.survivorUpdate }, currentSurvivorConnections: [] });
  assert.ok(un.survivorFieldReverts.some((r) => r.field === "phone" && r.to === null));
});

test("planMerge does not mutate its inputs and is repeatable", () => {
  const i = input(p("s"), p("m", { phone: "+54 9 11 4590-2294" }));
  const before = JSON.stringify(i);
  const first = planMerge(i);
  const second = planMerge(i);
  assert.equal(JSON.stringify(i), before);
  assert.deepEqual(second.survivorUpdate, first.survivorUpdate);
});
