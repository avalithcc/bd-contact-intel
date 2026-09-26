/**
 * Unit tests for src/lib/contacts/legacyRedirect.ts (task 11.4; design D8;
 * contact-record spec "Legacy route redirects"). Pure, no DB — the merge
 * chain follow-up (resolveSurvivor) is DB-backed and covered structurally
 * by the read smoke test, not here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decideLegacyRedirectFromMap } from "@/lib/contacts/legacyRedirectDecision";

test("a mapped legacy id with a person resolves to that person", () => {
  assert.deepEqual(decideLegacyRedirectFromMap("person-1"), { kind: "resolve", personId: "person-1" });
});

test("an own-company row (null personId) answers not_found", () => {
  assert.deepEqual(decideLegacyRedirectFromMap(null), { kind: "not_found" });
});

test("a legacy id with no person_id_map row at all answers not_found", () => {
  assert.deepEqual(decideLegacyRedirectFromMap(undefined), { kind: "not_found" });
});
