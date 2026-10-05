/**
 * Unit tests for src/lib/gmail/rebackfillPlan.ts — the pure decision behind
 * scripts/rebackfill-gmail-account.ts. No DB.
 * Run with: npx tsx --test tests/unit/gmailRebackfillPlan.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planGmailRebackfill, type RebackfillAccountState } from "@/lib/gmail/rebackfillPlan";
import { GMAIL_READONLY_SCOPE } from "@/lib/gmail/needsReconnectForSync";

function account(overrides: Partial<RebackfillAccountState> = {}): RebackfillAccountState {
  return {
    status: "connected",
    grantedScopes: GMAIL_READONLY_SCOPE,
    hasRefreshToken: true,
    historyId: "12345",
    backfillPageToken: null,
    ...overrides,
  };
}

test("a connected, fully synced account resets history_id and the page token", () => {
  const decision = planGmailRebackfill({ account: account(), actorExists: true });
  assert.deepEqual(decision, { ok: true, patch: { historyId: null, backfillPageToken: null, syncError: null } });
});

test("a dry run without --actor is allowed to plan (actorExists null = not asked)", () => {
  assert.equal(planGmailRebackfill({ account: account(), actorExists: null }).ok, true);
});

const refusals: [string, Parameters<typeof planGmailRebackfill>[0], string][] = [
  ["no account row", { account: null, actorExists: true }, "no_account"],
  ["status error", { account: account({ status: "error" }), actorExists: true }, "not_connected"],
  ["status revoked", { account: account({ status: "revoked" }), actorExists: true }, "not_connected"],
  ["no readonly scope", { account: account({ grantedScopes: null }), actorExists: true }, "needs_reconnect"],
  ["no refresh token", { account: account({ hasRefreshToken: false }), actorExists: true }, "needs_reconnect"],
  ["backfill page token set", { account: account({ backfillPageToken: "tok" }), actorExists: true }, "backfill_in_progress"],
  ["no history id yet (first backfill pending)", { account: account({ historyId: null }), actorExists: true }, "backfill_in_progress"],
  ["actor is not a bd row", { account: account(), actorExists: false }, "actor_not_found"],
];

for (const [name, input, reason] of refusals) {
  test(`refuses: ${name}`, () => {
    const decision = planGmailRebackfill(input);
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, reason);
  });
}

test("planning twice with the same input gives the same result and leaves the input untouched", () => {
  const input = { account: account(), actorExists: true };
  const snapshot = structuredClone(input);
  const first = planGmailRebackfill(input);
  const second = planGmailRebackfill(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, snapshot);
  if (first.ok && second.ok) assert.notEqual(first.patch, second.patch, "each call returns a fresh patch");
});
