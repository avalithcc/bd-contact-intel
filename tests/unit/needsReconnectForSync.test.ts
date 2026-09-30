/**
 * Unit tests for src/lib/gmail/needsReconnectForSync.ts (email-sync slice 1).
 * Run with: npx tsx --test tests/unit/needsReconnectForSync.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { needsReconnectForSync, GMAIL_READONLY_SCOPE } from "@/lib/gmail/needsReconnectForSync";

test("null grantedScopes (pre-existing connection) needs reconnect", () => {
  assert.equal(needsReconnectForSync(null), true);
});

test("undefined grantedScopes needs reconnect", () => {
  assert.equal(needsReconnectForSync(undefined), true);
});

test("empty string grantedScopes needs reconnect", () => {
  assert.equal(needsReconnectForSync(""), true);
});

test("send-only scope needs reconnect", () => {
  assert.equal(
    needsReconnectForSync("openid email https://www.googleapis.com/auth/gmail.send"),
    true,
  );
});

test("scope including gmail.readonly does not need reconnect", () => {
  assert.equal(
    needsReconnectForSync(
      `openid email https://www.googleapis.com/auth/gmail.send ${GMAIL_READONLY_SCOPE}`,
    ),
    false,
  );
});

test("readonly-only scope (no send) does not need reconnect for sync purposes", () => {
  assert.equal(needsReconnectForSync(GMAIL_READONLY_SCOPE), false);
});
