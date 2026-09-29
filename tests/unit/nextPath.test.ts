/**
 * Unit tests for src/lib/auth/nextPath.ts (auth-ux: post-login redirect).
 *
 * The `next` query param travels through a URL an attacker can craft
 * (e.g. a phishing link to /login?next=https://evil.com), so it must be
 * validated as a same-origin relative path before it is ever used as a
 * redirect target.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isSafeNextPath, sanitizeNextPath } from "@/lib/auth/nextPath";

test("accepts a same-origin relative path with a query string, unchanged", () => {
  const value = "/contacts?view=moveToEmail&company=nubiral";
  assert.equal(isSafeNextPath(value), true);
  assert.equal(sanitizeNextPath(value), value);
});

test("accepts a plain relative path", () => {
  assert.equal(isSafeNextPath("/tasks"), true);
});

const rejected: Array<[string, string]> = [
  ["protocol-relative //evil.com", "//evil.com"],
  ["backslash trick /\\evil.com", "/\\evil.com"],
  ["absolute https URL", "https://evil.com"],
  ["scheme without slashes http:evil.com", "http:evil.com"],
  ["javascript scheme", "javascript:alert(1)"],
  ["percent-encoded protocol-relative", "%2F%2Fevil.com"],
  ["percent-encoded backslash trick", "/%5Cevil.com"],
  ["empty string", ""],
  ["whitespace-prefixed protocol-relative", " //evil.com"],
  ["tab-prefixed relative path", "\t/contacts"],
];

for (const [label, value] of rejected) {
  test(`rejects ${label}`, () => {
    assert.equal(isSafeNextPath(value), false);
    assert.equal(sanitizeNextPath(value), "/");
  });
}

test("sanitizeNextPath falls back to a custom default", () => {
  assert.equal(sanitizeNextPath("https://evil.com", "/contacts"), "/contacts");
});

test("sanitizeNextPath treats null/undefined as unsafe", () => {
  assert.equal(sanitizeNextPath(null), "/");
  assert.equal(sanitizeNextPath(undefined), "/");
});
