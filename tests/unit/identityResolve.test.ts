/**
 * Unit tests for src/lib/identity/resolve.ts — the live-ingestion identity
 * resolver (design.md D11-D14; contact-identity spec "Live ingestion
 * resolves identity at write time"). Pure planning/row-building pieces only
 * — prefetchIdentityIndex/applyIdentityWrites touch the DB and are not unit
 * tested here (see resolve.ts's top comment).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIdentityWriteRows,
  buildPrefetchKeys,
  isIdentityDualWriteEnabled,
  planIdentityWrites,
  repointIdentityWriteRows,
  type ExistingPersonCandidate,
  type IdentityIngestRow,
  type IdentityWriteRows,
} from "@/lib/identity/resolve";

function row(overrides: Partial<IdentityIngestRow>): IdentityIngestRow {
  return {
    legacyTable: "contact",
    legacyId: "row-1",
    bdId: "bd-1",
    profileKey: null,
    connectedOn: null,
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    companyKey: null,
    jobTitle: null,
    industry: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingPersonCandidate>): ExistingPersonCandidate {
  return {
    id: "person-1",
    profileKey: null,
    firstName: "Jane",
    lastName: "Doe",
    companyKey: "acme",
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

test("planIdentityWrites: unmatched row creates a new person", () => {
  const plan = planIdentityWrites([row({ legacyId: "c1", profileKey: "li/jane" })], []);
  assert.equal(plan.newPersons.length, 1);
  assert.equal(plan.rowOutcomes.length, 1);
  assert.equal(plan.rowOutcomes[0].method, "new");
  assert.equal(plan.rowOutcomes[0].personRef, plan.newPersons[0].planRef);
  assert.equal(plan.report.new, 1);
});

test("planIdentityWrites: two rows with the same profile key dedup to one person within the chunk", () => {
  const rows = [
    row({ legacyId: "c1", profileKey: "li/jane", bdId: "bd-a" }),
    row({ legacyId: "c2", profileKey: "li/jane", bdId: "bd-b" }),
  ];
  const plan = planIdentityWrites(rows, []);
  assert.equal(plan.newPersons.length, 1);
  assert.equal(plan.rowOutcomes[0].personRef, plan.rowOutcomes[1].personRef);
  assert.equal(plan.rowOutcomes[0].method, "new");
  assert.equal(plan.rowOutcomes[1].method, "profile_key");
  assert.equal(plan.report.autoMerged, 1);
});

test("planIdentityWrites: matches an existing person by profile key and records an update", () => {
  const rows = [row({ legacyId: "c1", profileKey: "li/jane", jobTitle: "Head of Sales" })];
  const index = [existing({ id: "person-1", profileKey: "li/jane", jobTitle: null })];
  const plan = planIdentityWrites(rows, index);
  assert.equal(plan.newPersons.length, 0);
  assert.equal(plan.rowOutcomes[0].method, "profile_key");
  assert.equal(plan.rowOutcomes[0].personRef, "person-1");
  assert.equal(plan.existingUpdates.length, 1);
  assert.equal(plan.existingUpdates[0].merged.jobTitle, "Head of Sales");
});

test("planIdentityWrites: matches an existing person by verified email", () => {
  const rows = [row({ legacyId: "c1", email: "Jane@Acme.com", emailStatus: "verified" })];
  const index = [
    existing({ id: "person-2", emailNormalized: "jane@acme.com", emailStatus: "verified" }),
  ];
  const plan = planIdentityWrites(rows, index);
  assert.equal(plan.rowOutcomes[0].method, "verified_email");
  assert.equal(plan.rowOutcomes[0].personRef, "person-2");
});

test("planIdentityWrites: conflicting strong keys is flagged for review, never auto-merged", () => {
  const rows = [
    row({ legacyId: "c1", profileKey: "li/jane", email: "jane@acme.com", emailStatus: "verified" }),
  ];
  const index = [
    existing({ id: "person-a", profileKey: "li/jane" }),
    existing({ id: "person-b", emailNormalized: "jane@acme.com", emailStatus: "verified" }),
  ];
  const plan = planIdentityWrites(rows, index);
  assert.equal(plan.rowOutcomes[0].method, "review");
  assert.equal(plan.newPersons.length, 1);
  assert.equal(plan.reviewPairs.length, 2);
  assert.equal(plan.report.flaggedForReview, 1);
});

test("planIdentityWrites: name+company match is flagged for review, never auto-merged", () => {
  const rows = [row({ legacyId: "c1", firstName: "Jane", lastName: "Doe", company: "Acme" })];
  const index = [existing({ id: "person-3", companyKey: "acme" })];
  const plan = planIdentityWrites(rows, index);
  assert.equal(plan.rowOutcomes[0].method, "review");
  assert.equal(plan.reviewPairs.length, 1);
  assert.equal(plan.reviewPairs[0].reason, "name_company");
});

test("planIdentityWrites: skips own-company rows", () => {
  const rows = [row({ legacyId: "c1", company: "Avalith" })];
  const plan = planIdentityWrites(rows, []);
  assert.equal(plan.rowOutcomes[0].method, "skipped_own_company");
  assert.equal(plan.rowOutcomes[0].personRef, null);
  assert.equal(plan.report.ownCompanySkipped, 1);
  assert.equal(plan.newPersons.length, 0);
});

test("planIdentityWrites: merges properties without clobbering (R7) — longer/more specific wins", () => {
  const rows = [row({ legacyId: "c1", profileKey: "li/jane", jobTitle: "Sales" })];
  const index = [existing({ id: "person-1", profileKey: "li/jane", jobTitle: "Head of Sales, EMEA" })];
  const plan = planIdentityWrites(rows, index);
  assert.equal(plan.existingUpdates[0].merged.jobTitle, "Head of Sales, EMEA");
});

test("planIdentityWrites: a new person's roleGroup is classified from jobTitle (fresh-review fix 3, R7)", () => {
  const rows = [row({ legacyId: "c1", profileKey: "li/jane", jobTitle: "VP of Engineering" })];
  const plan = planIdentityWrites(rows, []);
  assert.equal(plan.newPersons[0].merged.roleGroup, "eng_leadership");
});

test("planIdentityWrites: an existing person's update carries roleGroup, re-classified from the merged jobTitle", () => {
  const rows = [row({ legacyId: "c1", profileKey: "li/jane", jobTitle: "VP of Engineering" })];
  const index = [existing({ id: "person-1", profileKey: "li/jane", jobTitle: null })];
  const plan = planIdentityWrites(rows, index);
  assert.equal(plan.existingUpdates[0].merged.roleGroup, "eng_leadership");
});

test("buildIdentityWriteRows: new persons carry roleGroup onto the insert row", () => {
  const plan = planIdentityWrites([row({ legacyId: "c1", jobTitle: "VP of Engineering" })], []);
  const built = buildIdentityWriteRows(plan, () => "gen-1");
  assert.equal(built.persons[0].roleGroup, "eng_leadership");
});

test("buildPrefetchKeys: collects distinct profile keys, verified emails and company keys", () => {
  const rows = [
    row({ profileKey: "li/a", email: "a@x.com", emailStatus: "verified", companyKey: "acme" }),
    row({ profileKey: "li/a", email: "b@x.com", emailStatus: "probable", company: "Acme" }),
  ];
  const keys = buildPrefetchKeys(rows);
  assert.deepEqual(keys.profileKeys, ["li/a"]);
  assert.deepEqual(keys.verifiedEmails, ["a@x.com"]);
  assert.deepEqual(keys.companyKeys, ["acme"]);
});

test("buildIdentityWriteRows: resolves new-person refs to generated ids for connections and idMap", () => {
  const rows = [row({ legacyId: "c1", profileKey: "li/jane", bdId: "bd-1" })];
  const plan = planIdentityWrites(rows, []);
  let n = 0;
  const built = buildIdentityWriteRows(plan, () => `gen-${++n}`);
  assert.equal(built.persons.length, 1);
  assert.equal(built.persons[0].id, "gen-1");
  assert.equal(built.connections[0].personId, "gen-1");
  assert.equal(built.idMap[0].personId, "gen-1");
  assert.equal(built.idMap[0].legacyId, "c1");
});

test("buildIdentityWriteRows: skipped own-company rows map to a null personId with no connection", () => {
  const rows = [row({ legacyId: "c1", company: "Avalith" })];
  const plan = planIdentityWrites(rows, []);
  const built = buildIdentityWriteRows(plan, () => "gen-1");
  assert.equal(built.idMap[0].personId, null);
  assert.equal(built.connections.length, 0);
});

test("buildIdentityWriteRows: review pairs resolve to sorted real ids", () => {
  const rows = [row({ legacyId: "c1", firstName: "Jane", lastName: "Doe", company: "Acme" })];
  const index = [existing({ id: "zzz-existing", companyKey: "acme" })];
  const plan = planIdentityWrites(rows, index);
  const built = buildIdentityWriteRows(plan, () => "aaa-new");
  assert.equal(built.duplicateCandidates.length, 1);
  assert.equal(built.duplicateCandidates[0].personAId, "aaa-new");
  assert.equal(built.duplicateCandidates[0].personBId, "zzz-existing");
});

function writeRows(overrides: Partial<IdentityWriteRows> = {}): IdentityWriteRows {
  return {
    persons: [],
    connections: [],
    idMap: [],
    duplicateCandidates: [],
    existingUpdates: [],
    ...overrides,
  };
}

test("repointIdentityWriteRows: no-op when there are no losers", () => {
  const rows = writeRows({
    connections: [{ personId: "gen-1", bdId: "bd-1", connectedOn: null, legacyContactId: "c1" }],
  });
  const result = repointIdentityWriteRows(rows, new Map());
  assert.equal(result, rows);
});

test("repointIdentityWriteRows: repoints connections.personId from loser to winner", () => {
  const rows = writeRows({
    connections: [{ personId: "gen-1", bdId: "bd-1", connectedOn: null, legacyContactId: "c1" }],
  });
  const result = repointIdentityWriteRows(rows, new Map([["gen-1", "person-winner"]]));
  assert.equal(result.connections[0].personId, "person-winner");
});

test("repointIdentityWriteRows: repoints idMap.personId from loser to winner, leaves null personId alone", () => {
  const rows = writeRows({
    idMap: [
      { legacyTable: "contact", legacyId: "c1", personId: "gen-1", method: "new" },
      { legacyTable: "contact", legacyId: "c2", personId: null, method: "skipped_own_company" },
    ],
  });
  const result = repointIdentityWriteRows(rows, new Map([["gen-1", "person-winner"]]));
  assert.equal(result.idMap[0].personId, "person-winner");
  assert.equal(result.idMap[1].personId, null);
});

test("repointIdentityWriteRows: repoints duplicateCandidates and re-sorts the pair (a < b)", () => {
  const rows = writeRows({
    duplicateCandidates: [
      { personAId: "gen-1", personBId: "zzz-existing", reason: "name_company", matchKey: "k" },
    ],
  });
  // Winner id sorts after "zzz-existing", so the pair must flip order.
  const result = repointIdentityWriteRows(rows, new Map([["gen-1", "zzz-winner"]]));
  assert.equal(result.duplicateCandidates[0].personAId, "zzz-existing");
  assert.equal(result.duplicateCandidates[0].personBId, "zzz-winner");
});

test("repointIdentityWriteRows: drops a duplicate-candidate pair that collapses to itself", () => {
  const rows = writeRows({
    duplicateCandidates: [
      { personAId: "gen-1", personBId: "gen-2", reason: "name_company", matchKey: "k" },
    ],
  });
  const winnerByLoserId = new Map([
    ["gen-1", "person-winner"],
    ["gen-2", "person-winner"],
  ]);
  const result = repointIdentityWriteRows(rows, winnerByLoserId);
  assert.equal(result.duplicateCandidates.length, 0);
});

test("repointIdentityWriteRows: dedupes pairs that become identical after repointing", () => {
  const rows = writeRows({
    duplicateCandidates: [
      { personAId: "gen-1", personBId: "other", reason: "name_company", matchKey: "k1" },
      { personAId: "gen-2", personBId: "other", reason: "name_company", matchKey: "k2" },
    ],
  });
  const winnerByLoserId = new Map([
    ["gen-1", "person-winner"],
    ["gen-2", "person-winner"],
  ]);
  const result = repointIdentityWriteRows(rows, winnerByLoserId);
  assert.equal(result.duplicateCandidates.length, 1);
});

test("isIdentityDualWriteEnabled: defaults to enabled", () => {
  assert.equal(isIdentityDualWriteEnabled({}), true);
});

test("isIdentityDualWriteEnabled: disabled only by the literal string 'false'", () => {
  assert.equal(isIdentityDualWriteEnabled({ IDENTITY_DUAL_WRITE: "false" }), false);
  assert.equal(isIdentityDualWriteEnabled({ IDENTITY_DUAL_WRITE: "0" }), true);
  assert.equal(isIdentityDualWriteEnabled({ IDENTITY_DUAL_WRITE: "" }), true);
});
