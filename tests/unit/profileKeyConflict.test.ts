import assert from "node:assert/strict";
import { test } from "node:test";
import { ProfileKeyTakenError, isProfileKeyUniqueViolation } from "@/lib/contacts/errors";
import { InvalidProfileKeyError } from "@/lib/contacts/propertyEdit";
import { contactActionErrorReason } from "@/app/(app)/contacts/actionErrors";

test("detects the profile_key unique violation, bare or wrapped by drizzle", () => {
  const driver = { code: "23505", constraint_name: "person_profile_key_unique" };
  assert.equal(isProfileKeyUniqueViolation(driver), true);
  assert.equal(isProfileKeyUniqueViolation(Object.assign(new Error("Failed query"), { cause: driver })), true);
});

test("ignores other unique violations and unrelated errors", () => {
  assert.equal(isProfileKeyUniqueViolation({ code: "23505", constraint_name: "person_email_unique" }), false);
  assert.equal(isProfileKeyUniqueViolation({ code: "40001" }), false);
  assert.equal(isProfileKeyUniqueViolation(new Error("boom")), false);
  assert.equal(isProfileKeyUniqueViolation(null), false);
});

test("typed errors map to their own action reasons", () => {
  assert.equal(contactActionErrorReason(new InvalidProfileKeyError("not_linkedin")), "invalid_profile_key");
  assert.equal(contactActionErrorReason(new ProfileKeyTakenError({ id: "x", name: "Marcus" })), "profile_key_taken");
});
