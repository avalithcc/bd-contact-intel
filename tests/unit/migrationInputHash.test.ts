/**
 * Unit tests for src/lib/migration/inputHash.ts — the `input_hash` guard
 * that lets `--execute --run=<id>` detect a stale dry run (design.md
 * "Migration plan": "refuses if `input_hash` changed"). Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCollapseInputHash } from "@/lib/migration/inputHash";
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
