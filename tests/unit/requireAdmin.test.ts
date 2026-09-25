/**
 * Unit tests for src/lib/auth/adminRole.ts — the pure admin-role check used
 * by requireAdmin() (src/lib/auth/requireAdmin.ts, the DB-backed wrapper
 * around src/lib/queries.ts#getCurrentBd). Pure function only, no DB — run
 * with: npx tsx --test tests/unit/requireAdmin.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AdminRequiredError, assertAdminRole } from "@/lib/auth/adminRole";

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
