/**
 * Unit tests for src/lib/auth/passwordPolicy.ts — the single pure validator
 * behind PasswordForm.tsx (and any future server-side path), so the "new
 * password" rules from the approved mockup (account-password.html: 12-char
 * minimum, current-password required, confirmation must match) live in one
 * tested place instead of being re-typed ad hoc in the form component.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_NEW_PASSWORD_LENGTH,
  validatePasswordChange,
} from "@/lib/auth/passwordPolicy";

const base = {
  currentPassword: "old-password-123",
  newPassword: "new-password-456",
  confirmPassword: "new-password-456",
  requireCurrent: true,
};

test("valid change with current password required returns null (no error)", () => {
  assert.equal(validatePasswordChange(base), null);
});

test("missing current password is rejected when requireCurrent is true", () => {
  const result = validatePasswordChange({ ...base, currentPassword: "" });
  assert.deepEqual(result, { field: "current", code: "required" });
});

test("missing current password is NOT checked when requireCurrent is false (recovery session)", () => {
  const result = validatePasswordChange({
    ...base,
    currentPassword: "",
    requireCurrent: false,
  });
  assert.equal(result, null);
});

test("new password shorter than the minimum is rejected", () => {
  const short = "a".repeat(MIN_NEW_PASSWORD_LENGTH - 1);
  const result = validatePasswordChange({
    ...base,
    newPassword: short,
    confirmPassword: short,
  });
  assert.deepEqual(result, { field: "new", code: "tooShort" });
});

test("new password exactly at the minimum length is accepted", () => {
  const exact = "a".repeat(MIN_NEW_PASSWORD_LENGTH);
  const result = validatePasswordChange({
    ...base,
    newPassword: exact,
    confirmPassword: exact,
  });
  assert.equal(result, null);
});

test("new password identical to the current password is rejected", () => {
  const result = validatePasswordChange({
    ...base,
    newPassword: base.currentPassword,
    confirmPassword: base.currentPassword,
  });
  assert.deepEqual(result, { field: "new", code: "sameAsCurrent" });
});

test("same-as-current is not checked when requireCurrent is false (nothing to compare)", () => {
  const result = validatePasswordChange({
    ...base,
    requireCurrent: false,
    currentPassword: "",
    newPassword: "recovery-password-789",
    confirmPassword: "recovery-password-789",
  });
  assert.equal(result, null);
});

test("mismatched confirmation is rejected", () => {
  const result = validatePasswordChange({
    ...base,
    confirmPassword: "something-else-entirely",
  });
  assert.deepEqual(result, { field: "confirm", code: "mismatch" });
});

test("tooShort is reported before mismatch when both are true", () => {
  const short = "a".repeat(MIN_NEW_PASSWORD_LENGTH - 1);
  const result = validatePasswordChange({
    ...base,
    newPassword: short,
    confirmPassword: "different-and-also-short",
  });
  assert.deepEqual(result, { field: "new", code: "tooShort" });
});

test("required-current is reported before any new-password check", () => {
  const short = "x";
  const result = validatePasswordChange({
    currentPassword: "",
    newPassword: short,
    confirmPassword: short,
    requireCurrent: true,
  });
  assert.deepEqual(result, { field: "current", code: "required" });
});

test("does not mutate the input object", () => {
  const input = { ...base };
  const frozen = { ...input };
  validatePasswordChange(input);
  assert.deepEqual(input, frozen);
});
