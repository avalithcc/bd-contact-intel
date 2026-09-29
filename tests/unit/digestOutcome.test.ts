/**
 * Unit tests for src/lib/tasks/digestOutcome.ts — the pure decision behind
 * the daily task-digest cron route's HTTP status (digest-hardening
 * backlog). Vercel's cron monitoring only sees a failed run when the
 * response status is non-2xx, so route.ts must return e.g. 500 whenever at
 * least one BD's send failed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { digestRunHasFailure } from "@/lib/tasks/digestOutcome";

test("digestRunHasFailure is false when nothing was attempted (empty results)", () => {
  assert.equal(digestRunHasFailure([]), false);
});

test("digestRunHasFailure is false for a dry run (skippedReason: dry_run)", () => {
  assert.equal(digestRunHasFailure([{ skippedReason: "dry_run" }]), false);
});

test("digestRunHasFailure is false when every BD is skipped for benign reasons", () => {
  assert.equal(
    digestRunHasFailure([{ skippedReason: "no_open_tasks_due" }, { skippedReason: "already_claimed" }]),
    false,
  );
});

test("digestRunHasFailure is false when every send actually succeeded (no skippedReason)", () => {
  assert.equal(digestRunHasFailure([{}, {}]), false);
});

test("digestRunHasFailure is true when at least one send failed", () => {
  assert.equal(
    digestRunHasFailure([{ skippedReason: "no_open_tasks_due" }, { skippedReason: "send_failed" }]),
    true,
  );
});

test("digestRunHasFailure is true for a send_failed after reclaiming an abandoned row (same skip reason)", () => {
  // The route reports a failed send the same way whether the claim was
  // fresh or a reclaim of an abandoned `pending` row (digestClaim.ts) — an
  // "abandoned-and-failed" outcome is just send_failed from the caller's
  // point of view.
  assert.equal(digestRunHasFailure([{ skippedReason: "send_failed" }]), true);
});
