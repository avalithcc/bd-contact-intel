/**
 * Unit tests for src/lib/migration/collapsePlanner.ts — the collapse-phase
 * migration planner (design.md "Migration plan" step 1; contact-migration
 * spec "Collapse duplicate `contact` rows"). Pure, no DB — fixtures only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planCollapse, type CollapseContactRow } from "@/lib/migration/collapsePlanner";

function row(overrides: Partial<CollapseContactRow>): CollapseContactRow {
  return {
    id: `legacy-${Math.random().toString(36).slice(2)}`,
    bdId: "bd-1",
    profileKey: "linkedin.com/in/janedoe",
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    companyKey: "acme",
    companyCategory: "product_saas",
    roleGroup: "engineering_manager",
    position: "Engineering Manager",
    industry: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    connectedOn: null,
    ...overrides,
  };
}

// --- contact-migration spec: "Same profile key across 3 BDs collapses to
// one Contact" ---------------------------------------------------------

test("3 contact rows sharing a profile key across 3 BDs collapse to 1 person with 3 connections", () => {
  const rows = [
    row({ id: "c1", bdId: "bd-1", connectedOn: "10 Mar 2021" }),
    row({ id: "c2", bdId: "bd-2", connectedOn: "1 Jan 2020" }),
    row({ id: "c3", bdId: "bd-3", connectedOn: "5 Jun 2022" }),
  ];

  const plan = planCollapse(rows);

  assert.equal(plan.persons.length, 1);
  const [person] = plan.persons;
  assert.equal(person.connections.length, 3);
  assert.deepEqual(
    new Set(person.connections.map((c) => c.bdId)),
    new Set(["bd-1", "bd-2", "bd-3"]),
  );
  // bd-2 connected earliest (1 Jan 2020) -> becomes the owner.
  assert.equal(person.ownerBdId, "bd-2");
  assert.equal(plan.report.contact.rowsRead, 3);
  assert.equal(plan.report.contact.new, 1);
  assert.equal(plan.report.contact.autoMergedByProfileKey, 2);
  assert.equal(plan.report.persons.created, 1);
  assert.equal(plan.report.persons.multiBd, 1);
});

test("distinct profile keys never merge", () => {
  const rows = [
    row({ id: "c1", profileKey: "linkedin.com/in/janedoe" }),
    row({ id: "c2", profileKey: "linkedin.com/in/johnsmith", firstName: "John", lastName: "Smith" }),
  ];
  const plan = planCollapse(rows);
  assert.equal(plan.persons.length, 2);
  assert.equal(plan.report.contact.autoMergedByProfileKey, 0);
  assert.equal(plan.report.contact.new, 2);
});

// --- own-company skip ---------------------------------------------------

test("own-company rows are skipped, not turned into a person", () => {
  const rows = [row({ id: "c1", company: "Avalith" })];
  const plan = planCollapse(rows);
  assert.equal(plan.persons.length, 0);
  assert.equal(plan.ownCompanySkipped.length, 1);
  assert.equal(plan.ownCompanySkipped[0].reason, "name");
  assert.equal(plan.report.contact.ownCompanySkipped, 1);
  assert.equal(plan.report.contact.rowsRead, 1);
});

// --- name+company match: review, never auto-merge -----------------------

test("a name+company match under a different profile key is flagged for review, not auto-merged", () => {
  const rows = [
    row({ id: "c1", profileKey: "linkedin.com/in/janedoe-1" }),
    row({ id: "c2", profileKey: "linkedin.com/in/janedoe-2" }), // same name+company, different profile
  ];
  const plan = planCollapse(rows);
  assert.equal(plan.persons.length, 2, "review creates a NEW person, it never auto-merges");
  assert.equal(plan.report.contact.flaggedForReview, 1);
  assert.equal(plan.report.contact.new, 1);
  assert.equal(plan.reviewPairs.length, 1);
  assert.equal(plan.reviewPairs[0].reason, "name_company");
});

// --- unparseable connectedOn ---------------------------------------------

test("unparseable connectedOn is counted and sorts last for owner selection", () => {
  const rows = [
    row({ id: "c1", bdId: "bd-1", connectedOn: "garbage" }),
    row({ id: "c2", bdId: "bd-2", connectedOn: "3 Feb 2021" }),
  ];
  const plan = planCollapse(rows);
  assert.equal(plan.persons.length, 1);
  assert.equal(plan.persons[0].ownerBdId, "bd-2");
  assert.equal(plan.report.connections.unparseableConnectedOn, 1);
  assert.equal(plan.report.connections.total, 2);
});

test("when every connection is unparseable, the first row's BD is kept as owner deterministically", () => {
  const rows = [
    row({ id: "c1", bdId: "bd-1", connectedOn: null }),
    row({ id: "c2", bdId: "bd-2", connectedOn: "nope" }),
  ];
  const plan = planCollapse(rows);
  assert.equal(plan.persons[0].ownerBdId, "bd-1");
  assert.equal(plan.report.connections.unparseableConnectedOn, 2);
});

// --- report totals stay consistent ---------------------------------------

test("report buckets are mutually exclusive and sum to rowsRead", () => {
  const rows = [
    row({ id: "c1", company: "Avalith" }), // skipped
    row({ id: "c2", profileKey: "linkedin.com/in/a" }), // new
    row({ id: "c3", profileKey: "linkedin.com/in/a" }), // auto-merge into c2's person
    row({
      id: "c4",
      profileKey: "linkedin.com/in/b",
      firstName: "Alice",
      lastName: "Smith",
      company: "Beta",
    }), // new — distinct name+company from the c2/c3 group
    row({
      id: "c5",
      profileKey: "linkedin.com/in/c",
      firstName: "Alice",
      lastName: "Smith",
      company: "Beta",
    }), // review — matches c4 by name+company under a different profile key
  ];
  const plan = planCollapse(rows);
  const { ownCompanySkipped, autoMergedByProfileKey, flaggedForReview, new: newCount, rowsRead } =
    plan.report.contact;
  assert.equal(ownCompanySkipped + autoMergedByProfileKey + flaggedForReview + newCount, rowsRead);
});
