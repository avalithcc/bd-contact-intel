/**
 * Unit tests for src/lib/ownCompany.ts — the single source of truth for
 * "is this contact/company Avalith itself" and the pure row-splitting
 * helper the import path (src/lib/queries.ts#upsertContacts) uses to skip
 * own-company rows. Pure functions only, no DB — run with:
 *   npx tsx --test tests/unit/ownCompany.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isOwnCompany, ownCompanyMatchReason, partitionOwnCompanyRows } from "@/lib/ownCompany";

test("isOwnCompany matches exact and case-insensitive names", () => {
  assert.equal(isOwnCompany("Avalith"), true);
  assert.equal(isOwnCompany("AVALITH"), true);
  assert.equal(isOwnCompany("avalith"), true);
});

test("isOwnCompany matches legal-suffix variants", () => {
  assert.equal(isOwnCompany("Avalith LLC"), true);
  assert.equal(isOwnCompany("Avalith S.A."), true);
  assert.equal(isOwnCompany("Avalith Inc"), true);
  assert.equal(isOwnCompany("Avalith Corp"), true);
});

test("isOwnCompany matches accented/punctuation variants", () => {
  assert.equal(isOwnCompany("Ävalith"), true);
  assert.equal(isOwnCompany("  Avalith  "), true);
  assert.equal(isOwnCompany("Avalith."), true);
});

test("isOwnCompany does not match unrelated companies", () => {
  assert.equal(isOwnCompany("Avalith Ventures"), false);
  assert.equal(isOwnCompany("Not Avalith"), false);
  assert.equal(isOwnCompany("Acme Corp"), false);
});

test("isOwnCompany handles blank/null/undefined input", () => {
  assert.equal(isOwnCompany(null), false);
  assert.equal(isOwnCompany(undefined), false);
  assert.equal(isOwnCompany(""), false);
  assert.equal(isOwnCompany("   "), false);
});

test("isOwnCompany matches by domain even without a matching name", () => {
  assert.equal(isOwnCompany(null, "avalith.net"), true);
  assert.equal(isOwnCompany(null, "avalith.com"), true);
  assert.equal(isOwnCompany(null, "www.avalith.net"), true);
  assert.equal(isOwnCompany(null, "AVALITH.NET"), true);
  assert.equal(isOwnCompany(null, "notavalith.net"), false);
});

test("partitionOwnCompanyRows splits Avalith coworkers out of a batch", () => {
  const rows = [
    { id: 1, company: "Acme Corp" },
    { id: 2, company: "Avalith" },
    { id: 3, company: "AVALITH LLC" },
    { id: 4, company: null },
    { id: 5, company: "Globex" },
  ];

  const { kept, skipped } = partitionOwnCompanyRows(rows);

  assert.deepEqual(
    kept.map((r) => r.id),
    [1, 4, 5],
  );
  assert.deepEqual(
    skipped.map((r) => r.id),
    [2, 3],
  );
});

test("partitionOwnCompanyRows keeps everything when there are no own-company rows", () => {
  const rows = [{ company: "Acme" }, { company: "Globex" }];
  const { kept, skipped } = partitionOwnCompanyRows(rows);
  assert.equal(kept.length, 2);
  assert.equal(skipped.length, 0);
});

test("partitionOwnCompanyRows skips everything when every row is Avalith", () => {
  const rows = [{ company: "Avalith" }, { company: "avalith s.a." }];
  const { kept, skipped } = partitionOwnCompanyRows(rows);
  assert.equal(kept.length, 0);
  assert.equal(skipped.length, 2);
});

test("partitionOwnCompanyRows skips a blank company with an Avalith email", () => {
  const rows = [{ company: null, email: "someone@avalith.net" }];
  const { kept, skipped } = partitionOwnCompanyRows(rows);
  assert.equal(kept.length, 0);
  assert.equal(skipped.length, 1);
});

test("partitionOwnCompanyRows keeps a non-Avalith company with a gmail address", () => {
  const rows = [{ company: "Acme Corp", email: "someone@gmail.com" }];
  const { kept, skipped } = partitionOwnCompanyRows(rows);
  assert.equal(kept.length, 1);
  assert.equal(skipped.length, 0);
});

test("ownCompanyMatchReason reports 'name' when the company name matches", () => {
  assert.equal(ownCompanyMatchReason("Avalith"), "name");
  assert.equal(ownCompanyMatchReason("Avalith LLC", "gmail.com"), "name");
});

test("ownCompanyMatchReason reports 'domain' only when the name doesn't match", () => {
  assert.equal(ownCompanyMatchReason(null, "avalith.net"), "domain");
  assert.equal(ownCompanyMatchReason("", "avalith.com"), "domain");
});

test("ownCompanyMatchReason reports null for unrelated input", () => {
  assert.equal(ownCompanyMatchReason("Acme Corp", "gmail.com"), null);
  assert.equal(ownCompanyMatchReason(null, null), null);
});
