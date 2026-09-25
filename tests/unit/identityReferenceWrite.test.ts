/**
 * Unit tests for src/lib/identity/referenceWrite.ts (task 4B.5/4B.6).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePersonIdLookup } from "@/lib/identity/referenceWrite";

test("resolvePersonIdLookup: contactId resolves to a contact lookup", () => {
  const lookup = resolvePersonIdLookup({ contactId: "contact-1" });
  assert.deepEqual(lookup, { legacyTable: "contact", legacyId: "contact-1" });
});

test("resolvePersonIdLookup: leadId resolves to a lead lookup", () => {
  const lookup = resolvePersonIdLookup({ leadId: "lead-1" });
  assert.deepEqual(lookup, { legacyTable: "lead", legacyId: "lead-1" });
});

test("resolvePersonIdLookup: contactId takes precedence when both are somehow set", () => {
  const lookup = resolvePersonIdLookup({ contactId: "contact-1", leadId: "lead-1" });
  assert.deepEqual(lookup, { legacyTable: "contact", legacyId: "contact-1" });
});

test("resolvePersonIdLookup: companyKey-only subject has nothing to map", () => {
  assert.equal(resolvePersonIdLookup({ companyKey: "acme" }), null);
});

test("resolvePersonIdLookup: no subject at all resolves to null", () => {
  assert.equal(resolvePersonIdLookup({}), null);
});
