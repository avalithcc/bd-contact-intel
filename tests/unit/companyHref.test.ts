/**
 * Unit tests for src/lib/contacts/companyHref.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { companyHref } from "@/lib/contacts/companyHref";

test("links to the company page when the key resolves to a company row", () => {
  assert.equal(companyHref("acme", true), "/companies/acme");
});

test("returns null (render plain text) when the key matches no company row", () => {
  assert.equal(companyHref("acme", false), null);
});

test("returns null when the contact has no company key at all", () => {
  assert.equal(companyHref(null, true), null);
  assert.equal(companyHref("", true), null);
});

test("percent-encodes keys that carry URL-significant characters", () => {
  // Not hypothetical: 60 company keys and 81 person company_keys in
  // production hold a "/", "?" or "#" (measured read-only 2026-10-09) —
  // e.g. "/root", "/nk studio", "andina licores / colemun". An unencoded
  // "/" splits the [key] segment, so these links were broken even when the
  // company existed.
  assert.equal(companyHref("a b/c?d#e", true), "/companies/a%20b%2Fc%3Fd%23e");
  assert.equal(companyHref("andina licores / colemun", true), "/companies/andina%20licores%20%2F%20colemun");
});

test("percent-encodes a literal percent so the page's decodeURIComponent round-trips", () => {
  // companies/[key]/page.tsx:90 decodes the param. A raw "%" would make
  // that decode throw on a malformed sequence; "%25" round-trips. No
  // production key holds a "%" today (measured 2026-10-09) — this pins the
  // contract before one does.
  assert.equal(companyHref("100% agency", true), "/companies/100%25%20agency");
  assert.equal(decodeURIComponent("100%25%20agency"), "100% agency");
});
