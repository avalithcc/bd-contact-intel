/**
 * Unit tests for src/lib/migration/inputHash.ts — the `input_hash` guard
 * that lets `--execute --run=<id>` detect a stale dry run (design.md
 * "Migration plan": "refuses if `input_hash` changed"). Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCollapseInputHash, computeFoldInputHash, computeHubSpotInputHash } from "@/lib/migration/inputHash";
import type { CollapseContactRow } from "@/lib/migration/collapsePlanner";

function row(overrides: Partial<CollapseContactRow> = {}): CollapseContactRow {
  return {
    id: "c1",
    bdId: "bd1",
    profileKey: "linkedin.com/in/janedoe",
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    companyKey: "acme",
    companyCategory: "product_saas",
    roleGroup: "engineering_manager",
    position: "Engineering Manager",
    industry: null,
    email: "jane@acme.com",
    emailStatus: "verified",
    emailConfidence: 90,
    emailSource: "linkedin_export",
    connectedOn: "12 Mar 2021",
    ...overrides,
  };
}

test("same row set produces the same hash", () => {
  const rows = [row({ id: "c1" }), row({ id: "c2", bdId: "bd2" })];
  assert.equal(computeCollapseInputHash(rows), computeCollapseInputHash(rows));
});

test("hash is independent of input order", () => {
  const a = [row({ id: "c1" }), row({ id: "c2" })];
  const b = [row({ id: "c2" }), row({ id: "c1" })];
  assert.equal(computeCollapseInputHash(a), computeCollapseInputHash(b));
});

test("changing any field changes the hash", () => {
  const base = [row({ id: "c1" })];
  const changed = [row({ id: "c1", company: "Different Co" })];
  assert.notEqual(computeCollapseInputHash(base), computeCollapseInputHash(changed));
});

test("adding a row changes the hash", () => {
  const base = [row({ id: "c1" })];
  const withExtra = [row({ id: "c1" }), row({ id: "c2" })];
  assert.notEqual(computeCollapseInputHash(base), computeCollapseInputHash(withExtra));
});

// --- regression: the hash must cover EVERY field the planner reads
// (fresh-review fix — a stale-but-undetected mutation on any of these
// fields would let --execute silently run against changed data) ----------

test("changing ANY field on the row changes the hash — no field is silently ignored", () => {
  const baseHash = computeCollapseInputHash([row({ id: "c1" })]);
  const mutations: Partial<CollapseContactRow>[] = [
    { bdId: "different-bd" },
    { profileKey: "linkedin.com/in/different" },
    { firstName: "Different" },
    { lastName: "Different" },
    { company: "Different Co" },
    { companyKey: "different" },
    { companyCategory: "banking_insurance" },
    { roleGroup: "sales_bd" },
    { position: "Different Title" },
    { industry: "Different Industry" },
    { email: "different@acme.com" },
    { emailStatus: "probable" },
    { emailConfidence: 42 },
    { emailSource: "different_source" },
    { connectedOn: "1 Jan 2019" },
  ];

  for (const mutation of mutations) {
    const mutatedHash = computeCollapseInputHash([row({ id: "c1", ...mutation })]);
    assert.notEqual(
      mutatedHash,
      baseHash,
      `expected the hash to change for mutation: ${JSON.stringify(mutation)}`,
    );
  }
});

// --- fresh-review fix: computeFoldInputHash must also cover
// activityTypesByLeadId, a planFoldLeads input (foldRun.ts passes it to the
// planner but the old hash never fingerprinted it) --------------------------

test("computeFoldInputHash changes when activity types change for the same leads and persons", () => {
  const leads = [{ id: "l1" }];
  const persons = [{ id: "p1" }];
  const noTypes = new Map<string, Set<string>>();
  const withTypes = new Map([["l1", new Set(["email_sent"])]]);

  assert.notEqual(
    computeFoldInputHash(leads, persons, noTypes),
    computeFoldInputHash(leads, persons, withTypes),
  );
});

test("computeFoldInputHash for activity types is insensitive to Map/Set insertion order", () => {
  const leads = [{ id: "l1" }, { id: "l2" }];
  const persons = [{ id: "p1" }];
  const a = new Map([
    ["l1", new Set(["email_sent", "meeting_logged"])],
    ["l2", new Set(["discarded"])],
  ]);
  const b = new Map([
    ["l2", new Set(["discarded"])],
    ["l1", new Set(["meeting_logged", "email_sent"])],
  ]);

  assert.equal(computeFoldInputHash(leads, persons, a), computeFoldInputHash(leads, persons, b));
});

// --- computeHubSpotInputHash (design D6: "covers what the planner reads,
// not the file bytes" — every DB snapshot the HubSpot planner touches must
// invalidate a stale dry run, not only the two CSV row sets) --------------

function hubspotArgs(overrides: { contacts?: { id: string }[] } = {}) {
  const contacts = overrides.contacts ?? [{ id: "1" }];
  const companies = [{ id: "10" }];
  const existingPersons = [{ id: "p1" }];
  const existingHubspotMap = [{ id: "1" }];
  const existingCompanies = [{ id: "acme" }];
  const bds = [{ id: "bd1" }];
  const existingHubspotActivityKeys = [{ id: "1:contacted" }];
  return [
    contacts,
    companies,
    existingPersons,
    existingHubspotMap,
    existingCompanies,
    bds,
    existingHubspotActivityKeys,
  ] as const;
}

test("computeHubSpotInputHash is stable for the same inputs and order-independent per set", () => {
  const args = hubspotArgs();
  assert.equal(computeHubSpotInputHash(...args), computeHubSpotInputHash(...args));
});

test("computeHubSpotInputHash changes when a contact row changes", () => {
  const base = computeHubSpotInputHash(...hubspotArgs());
  const changed = computeHubSpotInputHash(...hubspotArgs({ contacts: [{ id: "2" }] }));
  assert.notEqual(base, changed);
});

test("computeHubSpotInputHash changes when the DB snapshot (existing persons, map, companies, bds, or activity keys) changes, not only the CSV rows", () => {
  const [contacts, companies, existingPersons, existingHubspotMap, existingCompanies, bds, existingHubspotActivityKeys] =
    hubspotArgs();
  const base = computeHubSpotInputHash(
    contacts,
    companies,
    existingPersons,
    existingHubspotMap,
    existingCompanies,
    bds,
    existingHubspotActivityKeys,
  );
  const withExtraExistingPerson = computeHubSpotInputHash(
    contacts,
    companies,
    [...existingPersons, { id: "p2" }],
    existingHubspotMap,
    existingCompanies,
    bds,
    existingHubspotActivityKeys,
  );
  const withExtraActivityKey = computeHubSpotInputHash(
    contacts,
    companies,
    existingPersons,
    existingHubspotMap,
    existingCompanies,
    bds,
    [...existingHubspotActivityKeys, { id: "1:replied" }],
  );
  const withExtraExistingCompany = computeHubSpotInputHash(
    contacts,
    companies,
    existingPersons,
    existingHubspotMap,
    [...existingCompanies, { id: "beta" }],
    bds,
    existingHubspotActivityKeys,
  );
  assert.notEqual(base, withExtraExistingPerson);
  assert.notEqual(base, withExtraActivityKey);
  assert.notEqual(base, withExtraExistingCompany);
});
