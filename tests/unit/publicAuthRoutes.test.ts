/**
 * Unit tests for src/lib/auth/publicAuthRoutes.ts, the session-gate
 * allowlist used by src/lib/supabase/middleware.ts.
 *
 * /forgot-password must be an EXACT match, not a prefix match — a prefix
 * match would silently let a future route like /forgot-password-admin
 * bypass the session gate.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicAuthRoute } from "@/lib/auth/publicAuthRoutes";

test("/forgot-password itself is allowed", () => {
  assert.equal(isPublicAuthRoute("/forgot-password"), true);
});

test("a path that merely starts with /forgot-password is rejected", () => {
  assert.equal(isPublicAuthRoute("/forgot-password-x"), false);
});

test("a dot-dot traversal off /forgot-password is rejected", () => {
  assert.equal(isPublicAuthRoute("/forgot-password/../contacts"), false);
});

test("/login and /auth stay prefix matches by design (unchanged)", () => {
  assert.equal(isPublicAuthRoute("/login"), true);
  assert.equal(isPublicAuthRoute("/login/whatever"), true);
  assert.equal(isPublicAuthRoute("/auth/confirm"), true);
});

test("an unrelated protected path is rejected", () => {
  assert.equal(isPublicAuthRoute("/contacts"), false);
});
