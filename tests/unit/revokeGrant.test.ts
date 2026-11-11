import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRevokeResponse, grantIsGone } from "@/lib/gmail/revokeGrant";

test("a 2xx is a real revocation", () => {
  assert.equal(classifyRevokeResponse(200, ""), "revoked");
  assert.equal(classifyRevokeResponse(204, ""), "revoked");
});

test("400 invalid_token means the grant was already dead, not a failure", () => {
  // Treating this as a failure would wedge the operator on an account whose
  // token expired months ago: the revoke can never succeed, so the stale
  // encrypted token would stay in email_account forever.
  assert.equal(
    classifyRevokeResponse(400, '{"error":"invalid_token","error_description":"Token expired or revoked"}'),
    "already_invalid",
  );
  assert.equal(classifyRevokeResponse(400, "invalid_token"), "already_invalid");
});

test("every unproven outcome is retry — never success", () => {
  // This is the dangerous direction: calling any of these a success clears
  // our only copy of the refresh token while the grant stays LIVE on the
  // person's mailbox, with nothing left to revoke it with.
  for (const [status, body] of [
    [500, "Internal Server Error"],
    [503, "backend unavailable"],
    [429, "rate limited"],
    [0, "network failure"],
    [400, '{"error":"invalid_request"}'],
    [401, "unauthorized"],
    [403, "forbidden"],
  ] as const) {
    assert.equal(classifyRevokeResponse(status, body), "retry", `${status} ${body}`);
  }
});

test("only a proven-dead grant permits destroying our stored copy", () => {
  assert.equal(grantIsGone("revoked"), true);
  assert.equal(grantIsGone("already_invalid"), true);
  assert.equal(grantIsGone("retry"), false);
});
