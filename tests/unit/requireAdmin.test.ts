/**
 * Unit tests for src/lib/auth/adminRole.ts — the pure admin-role check used
 * by requireAdmin() (src/lib/auth/requireAdmin.ts, the DB-backed wrapper
 * around src/lib/queries.ts#getCurrentBd). Pure function only, no DB — run
 * with: npx tsx --test tests/unit/requireAdmin.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AdminRequiredError, assertAdminRole, isAdminRole } from "@/lib/auth/adminRole";

test("assertAdminRole allows a bd with role 'admin'", () => {
  assert.doesNotThrow(() => assertAdminRole({ role: "admin" }));
});

test("assertAdminRole rejects a bd with role 'bd'", () => {
  assert.throws(() => assertAdminRole({ role: "bd" }), AdminRequiredError);
});

test("assertAdminRole rejects a null bd (not authenticated)", () => {
  assert.throws(() => assertAdminRole(null), AdminRequiredError);
});

test("assertAdminRole rejects an unrecognized role", () => {
  assert.throws(() => assertAdminRole({ role: "superuser" }), AdminRequiredError);
});

// isAdminRole drives the owner-edit affordance (canReassignOwner) and shares
// its predicate with assertAdminRole, so the hidden control and the server
// gate can never disagree.
test("isAdminRole is true only for role 'admin'", () => {
  assert.equal(isAdminRole({ role: "admin" }), true);
  assert.equal(isAdminRole({ role: "bd" }), false);
  assert.equal(isAdminRole({ role: "superuser" }), false);
  assert.equal(isAdminRole(null), false);
  assert.equal(isAdminRole(undefined), false);
});
