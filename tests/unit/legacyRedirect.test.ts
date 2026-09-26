/**
 * Unit tests for src/lib/contacts/legacyRedirect.ts (task 11.4; design D8;
 * contact-record spec "Legacy route redirects"). Pure, no DB — the merge
 * chain follow-up (resolveSurvivor) is DB-backed and covered structurally
 * by the read smoke test, not here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decideLegacyRedirectFromMap, isValidLegacyId } from "@/lib/contacts/legacyRedirectDecision";

test("a mapped legacy id with a person resolves to that person", () => {
  assert.deepEqual(decideLegacyRedirectFromMap("person-1"), { kind: "resolve", personId: "person-1" });
});

test("an own-company row (null personId) answers not_found", () => {
  assert.deepEqual(decideLegacyRedirectFromMap(null), { kind: "not_found" });
});

test("a legacy id with no person_id_map row at all answers not_found", () => {
  assert.deepEqual(decideLegacyRedirectFromMap(undefined), { kind: "not_found" });
});

test("isValidLegacyId accepts a well-formed uuid", () => {
  assert.equal(isValidLegacyId("3fa85f64-5717-4562-b3fc-2c963f66afa6"), true);
});

test("isValidLegacyId rejects a non-uuid route param", () => {
  assert.equal(isValidLegacyId("not-a-uuid"), false);
});
