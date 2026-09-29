/**
 * Unit tests for src/lib/auth/passwordResetExitCode.ts — the pure exit-code
 * decision for scripts/reset-bd-password.ts's --execute path. Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordResetExitCode } from "@/lib/auth/passwordResetExitCode";

test("exits 0 when the password was reset and the audit_log row was written", () => {
  assert.equal(passwordResetExitCode(true), 0);
});

test("exits 2 (not 0, not 1) when the password was changed but the audit write failed", () => {
  const code = passwordResetExitCode(false);
  assert.equal(code, 2);
  assert.notEqual(code, 0);
  assert.notEqual(code, 1);
});
