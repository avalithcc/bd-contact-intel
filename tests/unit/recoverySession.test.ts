/**
 * Unit tests for src/lib/auth/recoverySession.ts.
 *
 * Supabase Auth JWTs carry an `amr` (Authentication Method Reference) claim
 * (see node_modules/@supabase/auth-js/dist/module/lib/types.d.ts, JwtPayload
 * — "Authentication Method References... String format: ['password', 'otp']
 * ... Object format: [{ method: 'password', timestamp }]"). This app only
 * ever establishes a session two ways: a normal `signInWithPassword` (whose
 * resulting token's amr always includes "password" — GoTrueClient.js's own
 * AMRMethods list has "password" as the literal, well-established grant-type
 * name) or `verifyOtp` on the recovery link landing in
 * src/app/auth/confirm/route.ts (the only other call site in this codebase,
 * confirmed by `rg -n "verifyOtp" src`), which never records "password" in
 * amr. So "amr exists and does not contain 'password'" reliably means
 * "this session did not come from a normal password login" — the exact
 * recovery-session predicate PasswordForm.tsx needs, fail-closed (any
 * decode failure defaults to requiring the current password).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeJwtAmr, isRecoverySession } from "@/lib/auth/recoverySession";

function makeToken(payload: unknown): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.sig`;
}

test("decodeJwtAmr normalizes the RFC-8176 string[] format", () => {
  const token = makeToken({ amr: ["password"] });
  assert.deepEqual(decodeJwtAmr(token), [{ method: "password" }]);
});

test("decodeJwtAmr normalizes the detailed AMREntry[] format", () => {
  const token = makeToken({ amr: [{ method: "otp", timestamp: 1234 }] });
  assert.deepEqual(decodeJwtAmr(token), [{ method: "otp", timestamp: 1234 }]);
});

test("decodeJwtAmr returns null when the amr claim is absent", () => {
  const token = makeToken({ sub: "user-1" });
  assert.equal(decodeJwtAmr(token), null);
});

test("decodeJwtAmr returns null for a malformed token (wrong segment count)", () => {
  assert.equal(decodeJwtAmr("only-one-segment"), null);
});

test("decodeJwtAmr returns null for a payload segment that is not valid JSON", () => {
  const token = `${Buffer.from("{}").toString("base64url")}.not-base64url-json.sig`;
  assert.equal(decodeJwtAmr(token), null);
});

test("decodeJwtAmr returns null for null/undefined input", () => {
  assert.equal(decodeJwtAmr(null), null);
  assert.equal(decodeJwtAmr(undefined), null);
});

test("isRecoverySession is false for a normal password-login session", () => {
  const token = makeToken({ amr: [{ method: "password", timestamp: 1 }] });
  assert.equal(isRecoverySession(token), false);
});

test("isRecoverySession is true for a session whose amr is otp-only (recovery/invite link)", () => {
  const token = makeToken({ amr: [{ method: "otp", timestamp: 1 }] });
  assert.equal(isRecoverySession(token), true);
});

test("isRecoverySession is false (fail-closed) when amr is missing entirely", () => {
  const token = makeToken({ sub: "user-1" });
  assert.equal(isRecoverySession(token), false);
});

test("isRecoverySession is false (fail-closed) for an undecodable token", () => {
  assert.equal(isRecoverySession("garbage"), false);
});

test("isRecoverySession is false (fail-closed) for a null/undefined access token", () => {
  assert.equal(isRecoverySession(null), false);
  assert.equal(isRecoverySession(undefined), false);
});

test("isRecoverySession is false when amr contains password alongside other methods", () => {
  // e.g. a hypothetical MFA-upgraded session — password was still used, so
  // this is not a recovery-only session and the current-password gate stays.
  const token = makeToken({
    amr: [
      { method: "password", timestamp: 1 },
      { method: "totp", timestamp: 2 },
    ],
  });
  assert.equal(isRecoverySession(token), false);
});
