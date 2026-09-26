/**
 * Unit tests for src/lib/contacts/companyDomain.ts (mockup-port r20 follow-up).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCompanyDomain } from "@/lib/contacts/companyDomain";

test("uses the company's own domain when it is set", () => {
  assert.equal(resolveCompanyDomain("acme.com", "jane@other.com"), "acme.com");
});

test("falls back to the contact's email domain when company.domain is null", () => {
  assert.equal(resolveCompanyDomain(null, "jane@acme.com"), "acme.com");
});

test("falls back to the contact's email domain when company.domain is undefined (no company row)", () => {
  assert.equal(resolveCompanyDomain(undefined, "jane@acme.com"), "acme.com");
});

test("returns null when company.domain is null and there is no email", () => {
  assert.equal(resolveCompanyDomain(null, null), null);
});

test("returns null when neither company.domain nor email is present", () => {
  assert.equal(resolveCompanyDomain(undefined, undefined), null);
});

test("an empty-string company.domain is treated as absent, falls back to email", () => {
  assert.equal(resolveCompanyDomain("", "jane@acme.com"), "acme.com");
});

test("a malformed email with no domain part yields null even though company.domain is absent", () => {
  assert.equal(resolveCompanyDomain(null, "not-an-email"), null);
});
