/**
 * Unit tests for src/lib/migration/foldPlanner.ts — the fold-leads-phase
 * migration planner (design.md "Migration plan" step 4; contact-migration
 * spec "Fold `lead` rows via the matcher"; contact-identity spec "Matcher
 * precedence"). Pure, no DB — fixtures only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeEmailFields,
  planFoldLeads,
  planStatusBackfills,
  type FoldExistingPerson,
  type FoldLeadRow,
  type FoldMergedFields,
} from "@/lib/migration/foldPlanner";

function person(overrides: Partial<FoldExistingPerson>): FoldExistingPerson {
  return {
    id: "person-1",
    profileKey: "linkedin.com/in/janedoe",
    firstName: "Jane",
    lastName: "Doe",
    companyKey: "acme",
    email: null,
    emailNormalized: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    jobTitle: null,
    industry: null,
    ...overrides,
  };
}

function lead(overrides: Partial<FoldLeadRow>): FoldLeadRow {
  return {
    id: `lead-${Math.random().toString(36).slice(2)}`,
    ownerBdId: "bd-1",
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    companyKey: "acme",
    jobTitle: null,
    industry: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    sourceKey: "fi-arg-2026",
    status: "new",
    updatedByBdId: null,
    updatedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// --- contact-migration spec: "Lead matching an existing collapsed Contact
// folds in" ------------------------------------------------------------

test("lead matching an existing person via verified email folds in, not a new person", () => {
  const existing = [
    person({ id: "p1", profileKey: null, email: "jane@corp.com", emailNormalized: "jane@corp.com", emailStatus: "verified" }),
  ];
  const leads = [lead({ id: "l1", email: "jane@corp.com", emailStatus: "verified" })];

  const plan = planFoldLeads(existing, leads);

  assert.equal(plan.newPersons.length, 0);
  assert.equal(plan.matchedUpdates.length, 1);
  assert.equal(plan.matchedUpdates[0].personId, "p1");
  assert.deepEqual(plan.mappings, [{ legacyLeadId: "l1", method: "verified_email", personRef: "p1" }]);
  assert.equal(plan.report.lead.autoMerged, 1);
  assert.equal(plan.report.persons.updated, 1);
  assert.equal(plan.report.persons.created, 0);
});

// --- contact-identity spec: "Lead without email or LinkedIn falls back to
// name+company" ----------------------------------------------------------

test("lead with no email or LinkedIn falls back to name+company review, never auto-merges", () => {
  const existing = [person({ id: "p1", profileKey: null })];
  const leads = [lead({ id: "l1" })];

  const plan = planFoldLeads(existing, leads);

  assert.equal(plan.matchedUpdates.length, 0);
  assert.equal(plan.newPersons.length, 1);
  assert.equal(plan.reviewPairs.length, 1);
  assert.equal(plan.reviewPairs[0].reason, "name_company");
  assert.equal(plan.report.lead.flaggedForReview, 1);
});

test("unmatched lead becomes a new person carrying ownerBdId and source", () => {
  const leads = [
    lead({ id: "l1", firstName: "New", lastName: "Person", company: "Other Co", companyKey: "other-co", ownerBdId: "bd-9", sourceKey: "fi-arg-2026" }),
  ];

  const plan = planFoldLeads([], leads);

  assert.equal(plan.newPersons.length, 1);
  const [created] = plan.newPersons;
  assert.equal(created.ownerBdId, "bd-9");
  assert.equal(created.sourceKey, "fi-arg-2026");
  assert.equal(plan.report.lead.new, 1);
  assert.equal(plan.report.persons.created, 1);
});

// --- contact-identity spec: "Own-company exclusion preserved" ------------

test("own-company lead is skipped, not turned into a person", () => {
  const leads = [lead({ id: "l1", company: "Avalith" })];

  const plan = planFoldLeads([], leads);

  assert.equal(plan.newPersons.length, 0);
  assert.equal(plan.mappings, plan.mappings); // no throw
  assert.equal(plan.mappings[0].method, "skipped_own_company");
  assert.equal(plan.mappings[0].personRef, null);
  assert.equal(plan.report.lead.ownCompanySkipped, 1);
});

// --- contact-identity spec: "Profile key and verified email disagree" ---
// (leads never carry a profile key, so this exercises 2 leads disagreeing
// with 2 different existing persons via email only — the weaker case still
// must never auto-merge across two different candidates.)

test("two leads sharing only a name+company key both route to the same review pair, never auto-merge", () => {
  const leads = [
    lead({ id: "l1", email: null }),
    lead({ id: "l2", email: null }),
  ];

  const plan = planFoldLeads([], leads);

  assert.equal(plan.newPersons.length, 2);
  assert.equal(plan.reviewPairs.length, 1);
  assert.equal(plan.report.lead.new, 1);
  assert.equal(plan.report.lead.flaggedForReview, 1);
});

test("matched lead's richer job title wins over an existing shorter value (contact-identity R7)", () => {
  const existing = [
    person({ id: "p1", profileKey: null, email: "jane@corp.com", emailNormalized: "jane@corp.com", emailStatus: "verified", jobTitle: "VP" }),
  ];
  const leads = [lead({ id: "l1", email: "jane@corp.com", emailStatus: "verified", jobTitle: "VP Engineering" })];

  const plan = planFoldLeads(existing, leads);

  assert.equal(plan.matchedUpdates[0].merged.jobTitle, "VP Engineering");
});

// --- contact-identity R7: email fields move together, higher status rank
// wins (mirrors collapsePlanner.ts's mergeEmailFields) --------------------
//
// planFoldLeads can't exercise a genuine rank contest end-to-end: the only
// auto-merge path for a lead is verified_email, which requires the incoming
// AND existing email VALUES to already be equal-and-verified, so ranks never
// actually differ once matched. mergeEmailFields itself must still resolve
// ranks correctly for callers (it's exported for exactly this reason), so it
// gets a direct unit test instead.

function mergedFields(overrides: Partial<FoldMergedFields>): FoldMergedFields {
  return {
    firstName: null,
    lastName: null,
    companyKey: null,
    jobTitle: null,
    industry: null,
    email: null,
    emailNormalized: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    ...overrides,
  };
}

test("mergeEmailFields picks the side with the higher emailStatusRank when both have an email", () => {
  const weaker = mergedFields({
    email: "jane@old.com",
    emailNormalized: "jane@old.com",
    emailStatus: "probable",
    emailConfidence: 40,
    emailSource: "guess",
  });
  const stronger = mergedFields({
    email: "jane@new.com",
    emailNormalized: "jane@new.com",
    emailStatus: "verified",
    emailConfidence: 90,
    emailSource: "waterfall",
  });

  const result = mergeEmailFields(weaker, stronger);

  assert.deepEqual(result, {
    email: "jane@new.com",
    emailNormalized: "jane@new.com",
    emailStatus: "verified",
    emailConfidence: 90,
    emailSource: "waterfall",
  });
});

test("mergeEmailFields keeps a present email over an absent one regardless of rank", () => {
  const noEmail = mergedFields({ emailStatus: "none" });
  const hasEmail = mergedFields({
    email: "jane@corp.com",
    emailNormalized: "jane@corp.com",
    emailStatus: "probable",
    emailConfidence: 30,
    emailSource: "guess",
  });

  assert.equal(mergeEmailFields(noEmail, hasEmail).email, "jane@corp.com");
  assert.equal(mergeEmailFields(hasEmail, noEmail).email, "jane@corp.com");
});

test("mergeEmailFields keeps `a` on a genuine tie (same rank, same email)", () => {
  const a = mergedFields({
    email: "jane@corp.com",
    emailNormalized: "jane@corp.com",
    emailStatus: "verified",
    emailConfidence: 50,
    emailSource: "a-source",
  });
  const b = mergedFields({
    email: "jane@corp.com",
    emailNormalized: "jane@corp.com",
    emailStatus: "verified",
    emailConfidence: 99,
    emailSource: "b-source",
  });

  assert.equal(mergeEmailFields(a, b).emailSource, "a-source");
});

// --- Coverage gaps found in review -------------------------------------

test("verified-email match to person A wins outright even when the lead also weakly matches person B by name+company", () => {
  const existing = [
    person({
      id: "pA",
      profileKey: null,
      firstName: "Someone",
      lastName: "Else",
      companyKey: "other-co",
      email: "jane@corp.com",
      emailNormalized: "jane@corp.com",
      emailStatus: "verified",
    }),
    person({
      id: "pB",
      profileKey: null,
      firstName: "Jane",
      lastName: "Doe",
      companyKey: "acme",
      email: null,
    }),
  ];
  // Matches pA by verified email AND pB by name+company (matcher precedence:
  // a strong-key auto match short-circuits before name+company is checked).
  const leads = [
    lead({
      id: "l1",
      firstName: "Jane",
      lastName: "Doe",
      company: "Acme",
      companyKey: "acme",
      email: "jane@corp.com",
      emailStatus: "verified",
    }),
  ];

  const plan = planFoldLeads(existing, leads);

  assert.equal(plan.matchedUpdates.length, 1);
  assert.equal(plan.matchedUpdates[0].personId, "pA");
  assert.equal(plan.reviewPairs.length, 0);
  assert.equal(plan.newPersons.length, 0);
  assert.deepEqual(plan.mappings, [{ legacyLeadId: "l1", method: "verified_email", personRef: "pA" }]);
});

test("two different leads folding into the same existing person both map to it and accumulate merged fields", () => {
  const existing = [
    person({
      id: "p1",
      profileKey: null,
      email: "jane@corp.com",
      emailNormalized: "jane@corp.com",
      emailStatus: "verified",
      jobTitle: null,
      industry: null,
    }),
  ];
  const leads = [
    lead({ id: "l1", email: "jane@corp.com", emailStatus: "verified", jobTitle: "Manager", industry: null }),
    lead({ id: "l2", email: "jane@corp.com", emailStatus: "verified", jobTitle: "VP Engineering", industry: "SaaS" }),
  ];

  const plan = planFoldLeads(existing, leads);

  assert.equal(plan.matchedUpdates.length, 1);
  assert.equal(plan.matchedUpdates[0].personId, "p1");
  assert.deepEqual(
    plan.mappings.map((m) => m.personRef),
    ["p1", "p1"],
  );
  // Longer/richer value wins each round (contact-identity R7): "VP
  // Engineering" beats "Manager", and industry fills in from null.
  assert.equal(plan.matchedUpdates[0].merged.jobTitle, "VP Engineering");
  assert.equal(plan.matchedUpdates[0].merged.industry, "SaaS");
  assert.equal(plan.report.lead.autoMerged, 2);
  assert.equal(plan.report.persons.updated, 1);
});

test("a name+company key shared by 2+ existing persons fans out a review pair per candidate", () => {
  const existing = [
    person({ id: "p1", profileKey: null, firstName: "Jane", lastName: "Doe", companyKey: "acme", email: null }),
    person({ id: "p2", profileKey: null, firstName: "Jane", lastName: "Doe", companyKey: "acme", email: null }),
  ];
  const leads = [lead({ id: "l1", firstName: "Jane", lastName: "Doe", company: "Acme", companyKey: "acme", email: null })];

  const plan = planFoldLeads(existing, leads);

  assert.equal(plan.matchedUpdates.length, 0);
  assert.equal(plan.newPersons.length, 1);
  const [newPerson] = plan.newPersons;
  assert.equal(plan.reviewPairs.length, 2);
  const refs = plan.reviewPairs.flatMap((pair) => [pair.refA, pair.refB]);
  assert.ok(refs.includes("p1"));
  assert.ok(refs.includes("p2"));
  assert.ok(refs.includes(newPerson.planId));
  assert.ok(plan.reviewPairs.every((pair) => pair.reason === "name_company"));
});

// --- contact-migration spec: "Backfill activity for manually set status" ---

test("a lead with a manually set status and no supporting activity gets a status_backfill row", () => {
  const leads = [
    lead({
      id: "l1",
      status: "meeting",
      updatedByBdId: "bd-7",
      updatedAt: new Date("2026-02-01T00:00:00Z"),
    }),
  ];

  const plan = planFoldLeads([], leads, new Map());

  assert.equal(plan.statusBackfills.length, 1);
  assert.equal(plan.report.lead.statusBackfilled, 1);
  const [backfill] = plan.statusBackfills;
  assert.equal(backfill.status, "meeting");
  assert.equal(backfill.originalEditorBdId, "bd-7");
  assert.equal(backfill.originalAt.toISOString(), "2026-02-01T00:00:00.000Z");
  // Resolves to the same person ref foldWriteRows.ts uses for the mapping.
  assert.equal(backfill.personRef, plan.mappings[0].personRef);
});

test("a lead with status 'new' never gets a status_backfill row (it's the default, not a manual decision)", () => {
  const leads = [lead({ id: "l1", status: "new" })];

  const plan = planFoldLeads([], leads, new Map());

  assert.equal(plan.statusBackfills.length, 0);
  assert.equal(plan.report.lead.statusBackfilled, 0);
});

test("a lead with a manually set status that already has supporting activity is not backfilled", () => {
  const leads = [lead({ id: "l1", status: "meeting" })];
  const activityTypesByLeadId = new Map([["l1", new Set(["meeting_logged"])]]);

  const plan = planFoldLeads([], leads, activityTypesByLeadId);

  assert.equal(plan.statusBackfills.length, 0);
});

test("an own-company-skipped lead with a manually set status is never backfilled (no person to attach to)", () => {
  const leads = [lead({ id: "l1", company: "Avalith", status: "discarded" })];

  const plan = planFoldLeads([], leads, new Map());

  assert.equal(plan.statusBackfills.length, 0);
});

// --- fresh-review fix: STATUS_SUPPORTING_ACTIVITY_TYPES audit against
// design.md "Status derivation (R4)" (~lines 47-53) + decision D17 —
// `replied` is only ever evidenced by a connection's receivedCount>0, NEVER
// by an activity record, so a lead manually marked `replied` must ALWAYS get
// a status_backfill regardless of what other activities already exist. -----

test("a lead manually marked replied ALWAYS gets a status_backfill, even with a supporting-looking email_sent activity (D17: no activity type evidences replied)", () => {
  const leads = [lead({ id: "l1", status: "replied" })];
  const activityTypesByLeadId = new Map([["l1", new Set(["email_sent"])]]);

  const plan = planFoldLeads([], leads, activityTypesByLeadId);

  assert.equal(plan.statusBackfills.length, 1);
  assert.equal(plan.statusBackfills[0].status, "replied");
});

test("a lead manually marked contacted with an existing email_sent activity is not backfilled (email_sent is real contacted evidence)", () => {
  const leads = [lead({ id: "l1", status: "contacted" })];
  const activityTypesByLeadId = new Map([["l1", new Set(["email_sent"])]]);

  const plan = planFoldLeads([], leads, activityTypesByLeadId);

  assert.equal(plan.statusBackfills.length, 0);
});

test("a lead manually marked discarded with an existing discarded activity is not backfilled", () => {
  const leads = [lead({ id: "l1", status: "discarded" })];
  const activityTypesByLeadId = new Map([["l1", new Set(["discarded"])]]);

  const plan = planFoldLeads([], leads, activityTypesByLeadId);

  assert.equal(plan.statusBackfills.length, 0);
});

test("planStatusBackfills falls back to createdAt when updatedAt is null", () => {
  const leads = [
    lead({
      id: "l1",
      status: "contacted",
      updatedByBdId: null,
      updatedAt: null,
      createdAt: new Date("2025-06-01T00:00:00Z"),
    }),
  ];
  const mappings = [{ legacyLeadId: "l1", method: "new" as const, personRef: "np1" }];

  const backfills = planStatusBackfills(leads, mappings, new Map());

  assert.equal(backfills.length, 1);
  assert.equal(backfills[0].originalAt.toISOString(), "2025-06-01T00:00:00.000Z");
});
