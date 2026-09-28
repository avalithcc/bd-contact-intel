/**
 * Unit tests for src/lib/contacts/partnerAccountContacts.ts — the curated,
 * owner-approved list of 12 partner-account contacts (currently free text
 * inside `company.notes`) and the pure helpers that turn them into
 * create-contact rows: the display-name splitter and the row-builder
 * planner, per the task's "unit coverage for the name split and the row
 * builder" requirement.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PARTNER_ACCOUNT_CONTACT_ROWS,
  PARTNER_ACCOUNT_CONTACT_SOURCE_KEY,
  planPartnerAccountContactRows,
  splitDisplayName,
} from "@/lib/contacts/partnerAccountContacts";

test("splitDisplayName: two-token name splits into first/last", () => {
  assert.deepEqual(splitDisplayName("Angela Leon"), { firstName: "Angela", lastName: "Leon" });
});

test("splitDisplayName: three-token name keeps everything but the last token as firstName", () => {
  assert.deepEqual(splitDisplayName("Nathalie Denise Szlafsztein"), {
    firstName: "Nathalie Denise",
    lastName: "Szlafsztein",
  });
  assert.deepEqual(splitDisplayName("Eliseo Cohen Imach"), {
    firstName: "Eliseo Cohen",
    lastName: "Imach",
  });
});

test("splitDisplayName: single-token name has no last name", () => {
  assert.deepEqual(splitDisplayName("Madonna"), { firstName: "Madonna", lastName: "" });
});

test("splitDisplayName: collapses repeated internal whitespace", () => {
  assert.deepEqual(splitDisplayName("  Ana   Maria   Gomez "), {
    firstName: "Ana Maria",
    lastName: "Gomez",
  });
});

test("the curated list has exactly the 12 owner-approved rows, each with an email and a company", () => {
  assert.equal(PARTNER_ACCOUNT_CONTACT_ROWS.length, 12);
  for (const row of PARTNER_ACCOUNT_CONTACT_ROWS) {
    assert.ok(row.displayName.trim().length > 0, `missing displayName for ${JSON.stringify(row)}`);
    assert.ok(row.email.includes("@"), `missing/invalid email for ${row.displayName}`);
    assert.ok(row.companyDisplay.trim().length > 0, `missing companyDisplay for ${row.displayName}`);
  }
});

test("planPartnerAccountContactRows: resolves companyKey via normalizeCompanyKey, not a trusted column", () => {
  // "ACK Storm" only matches an existing-company set keyed by
  // normalizeCompanyKey's output ("ack storm"), never the raw display text
  // — this would fail if the planner fell back to trusting a raw column.
  const existingCompanyKeys = new Set(["ack storm"]);
  const plan = planPartnerAccountContactRows(
    [{ displayName: "Angela Leon", email: "angela.leon@ackstorm.com", companyDisplay: "ACK Storm" }],
    new Map(),
    existingCompanyKeys,
  );
  assert.equal(plan.missingCompanyKeys.length, 0);
  assert.equal(plan.toCreate.length, 1);
  assert.equal(plan.toCreate[0].companyKey, "ack storm");
});

test("planPartnerAccountContactRows: an existing person's email routes the row to existingEmailMatches, not toCreate", () => {
  const rows = [{ displayName: "Ana Gomez", email: "ana@acme.com", companyDisplay: "Acme" }];
  const existingByEmail = new Map([["ana@acme.com", "person-123"]]);
  const plan = planPartnerAccountContactRows(rows, existingByEmail, new Set(["acme"]));
  assert.deepEqual(plan.toCreate, []);
  assert.deepEqual(plan.existingEmailMatches, [
    { displayName: "Ana Gomez", email: "ana@acme.com", existingPersonId: "person-123" },
  ]);
  assert.deepEqual(plan.missingCompanyKeys, []);
});

test("planPartnerAccountContactRows: a company_key that doesn't exist yet is reported, not silently created", () => {
  const rows = [{ displayName: "Ana Gomez", email: "ana@acme.com", companyDisplay: "Ghost Co" }];
  const plan = planPartnerAccountContactRows(rows, new Map(), new Set(["acme"]));
  assert.deepEqual(plan.toCreate, []);
  assert.deepEqual(plan.missingCompanyKeys, [{ displayName: "Ana Gomez", companyKey: "ghost co" }]);
});

test("planPartnerAccountContactRows: a resolvable row builds the full create row with the shared source_key", () => {
  const rows = [{ displayName: "Ana Maria Gomez", email: "Ana@Acme.com", companyDisplay: "Acme" }];
  const plan = planPartnerAccountContactRows(rows, new Map(), new Set(["acme"]));
  assert.deepEqual(plan.toCreate, [
    {
      displayName: "Ana Maria Gomez",
      firstName: "Ana Maria",
      lastName: "Gomez",
      email: "Ana@Acme.com",
      emailNormalized: "ana@acme.com",
      company: "Acme",
      companyKey: "acme",
      sourceKey: PARTNER_ACCOUNT_CONTACT_SOURCE_KEY,
    },
  ]);
});

test("planPartnerAccountContactRows is a pure planner: calling it twice with the same input gives the same result and never mutates the input rows", () => {
  const rows = [
    { displayName: "Ana Gomez", email: "ana@acme.com", companyDisplay: "Acme" },
    { displayName: "Beto Diaz", email: "beto@ghost.com", companyDisplay: "Ghost Co" },
  ];
  const rowsSnapshot = JSON.parse(JSON.stringify(rows));
  const existingByEmail = new Map([["ana@acme.com", "person-1"]]);
  const existingCompanyKeys = new Set(["acme"]);

  const first = planPartnerAccountContactRows(rows, existingByEmail, existingCompanyKeys);
  const second = planPartnerAccountContactRows(rows, existingByEmail, existingCompanyKeys);

  assert.deepEqual(first, second);
  assert.deepEqual(rows, rowsSnapshot);
});
