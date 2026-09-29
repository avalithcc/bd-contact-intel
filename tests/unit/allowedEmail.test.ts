/**
 * Unit tests for src/lib/auth/allowedEmail.ts — the server-side domain
 * allowlist. This is the ONLY place the @avalith.net rule may be encoded;
 * getCurrentBd(), the session-gate middleware, and LoginForm.tsx all import
 * isAllowedWorkEmail() instead of re-deriving it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedWorkEmail } from "@/lib/auth/allowedEmail";

test("accepts an exact @avalith.net address", () => {
  assert.equal(isAllowedWorkEmail("cristian@avalith.net"), true);
});

test("is case-insensitive on the domain", () => {
  assert.equal(isAllowedWorkEmail("cristian@Avalith.NET"), true);
});

test("trims surrounding whitespace", () => {
  assert.equal(isAllowedWorkEmail("  cristian@avalith.net  "), true);
});

test("rejects a subdomain trick", () => {
  assert.equal(isAllowedWorkEmail("x@evil.avalith.net"), false);
});

test("rejects a suffix trick where avalith.net is a subdomain of another domain", () => {
  assert.equal(isAllowedWorkEmail("x@avalith.net.evil.com"), false);
});

test("rejects a domain that merely contains avalith.net as a prefix", () => {
  assert.equal(isAllowedWorkEmail("x@avalith.network"), false);
});

test("rejects a lookalike domain", () => {
  assert.equal(isAllowedWorkEmail("x@notavalith.net"), false);
});

test("rejects multiple @ signs", () => {
  assert.equal(isAllowedWorkEmail("x@y@avalith.net"), false);
});

test("rejects empty, null, and undefined", () => {
  assert.equal(isAllowedWorkEmail(""), false);
  assert.equal(isAllowedWorkEmail("   "), false);
  assert.equal(isAllowedWorkEmail(null), false);
  assert.equal(isAllowedWorkEmail(undefined), false);
});

test("rejects a value with no local part", () => {
  assert.equal(isAllowedWorkEmail("@avalith.net"), false);
});
