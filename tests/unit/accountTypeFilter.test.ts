/**
 * Unit tests for src/lib/companies/accountTypeFilter.ts — the `/companies`
 * list's account-type filter (BACKLOG.md Layer 3 "account-type-filter").
 * Two pure surfaces: the URL param validator (same ignore-invalid contract
 * as the page's own `isStage`/`isView` guards) and the WHERE condition
 * builder, split out of listQueries.ts so it's testable without a live
 * `DATABASE_URL` (src/db/index.ts throws at import time when unset).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { company } from "@/db/schema";
import { accountTypeCondition, isAccountType } from "@/lib/companies/accountTypeFilter";

test("isAccountType: accepts each known account type", () => {
  assert.equal(isAccountType("partner"), true);
  assert.equal(isAccountType("client"), true);
  assert.equal(isAccountType("strategic_org"), true);
});

test("isAccountType: rejects unknown values, empty string and undefined", () => {
  assert.equal(isAccountType("prospect"), false);
  assert.equal(isAccountType(""), false);
  assert.equal(isAccountType(undefined), false);
});

test("accountTypeCondition: builds an equality condition for a valid account type", () => {
  assert.deepEqual(accountTypeCondition("partner"), eq(company.accountType, "partner"));
  assert.deepEqual(accountTypeCondition("client"), eq(company.accountType, "client"));
});

test("accountTypeCondition: returns undefined when no filter is set", () => {
  assert.equal(accountTypeCondition(undefined), undefined);
});
