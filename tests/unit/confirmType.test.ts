/**
 * Unit tests for src/lib/auth/confirmType.ts — the allowlist gating which
 * `type` values /auth/confirm/route.ts will pass to Supabase's verifyOtp.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedConfirmType } from "@/lib/auth/confirmType";

test("allows recovery", () => {
  assert.equal(isAllowedConfirmType("recovery"), true);
});

test("allows invite", () => {
  assert.equal(isAllowedConfirmType("invite"), true);
});

test("rejects signup", () => {
  assert.equal(isAllowedConfirmType("signup"), false);
});

test("rejects magiclink", () => {
  assert.equal(isAllowedConfirmType("magiclink"), false);
});

test("rejects email_change", () => {
  assert.equal(isAllowedConfirmType("email_change"), false);
});

test("rejects null, undefined, and empty string", () => {
  assert.equal(isAllowedConfirmType(null), false);
  assert.equal(isAllowedConfirmType(undefined), false);
  assert.equal(isAllowedConfirmType(""), false);
});

test("rejects an arbitrary/unknown value", () => {
  assert.equal(isAllowedConfirmType("recoveryish"), false);
});
