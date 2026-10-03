/**
 * Unit tests for src/lib/contacts/actionOutcome.ts — the seam that turns a
 * THROWN server action (dropped connection, HTTP 500) into the same typed
 * `{ ok: false }` result the record page already renders (launch-readiness
 * finding F1).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { settleAction } from "@/lib/contacts/actionOutcome";

const OK = { ok: true } as const;
const boom = () => Promise.reject(new Error("network"));

test("settleAction passes a normal result through untouched", async () => {
  assert.deepEqual(await settleAction(async () => OK), OK);
  assert.deepEqual(await settleAction(async () => ({ ok: false, reason: "not_found" }) as const), {
    ok: false,
    reason: "not_found",
  });
});

test("settleAction turns a throw into 'unconfirmed' instead of rejecting", async () => {
  assert.deepEqual(await settleAction(boom), { ok: false, reason: "unconfirmed" });
});
