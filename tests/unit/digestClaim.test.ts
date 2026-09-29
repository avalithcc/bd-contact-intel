/**
 * Unit tests for src/lib/tasks/digestClaim.ts — the pure "abandoned claim"
 * decision behind the daily task-digest cron's stuck-row reclaim
 * (digest-hardening backlog). A `task_digest_send` row left `status =
 * 'pending'` because its claiming run died before sending must eventually
 * be reclaimed by a later run; this file is the boundary logic for "how
 * long is too long", shared by claimDigestSend's SQL cutoff so the two can
 * never drift apart.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ABANDONED_CLAIM_THRESHOLD_MS,
  abandonedClaimCutoff,
  isAbandonedPendingClaim,
} from "@/lib/tasks/digestClaim";

const NOW = new Date("2026-09-29T12:00:00.000Z");

test("isAbandonedPendingClaim is false for a claim made right now", () => {
  assert.equal(isAbandonedPendingClaim(NOW, NOW), false);
});

test("isAbandonedPendingClaim is false exactly at the threshold boundary (not yet abandoned)", () => {
  const createdAt = new Date(NOW.getTime() - ABANDONED_CLAIM_THRESHOLD_MS);
  assert.equal(isAbandonedPendingClaim(createdAt, NOW), false);
});

test("isAbandonedPendingClaim is true one millisecond past the threshold", () => {
  const createdAt = new Date(NOW.getTime() - ABANDONED_CLAIM_THRESHOLD_MS - 1);
  assert.equal(isAbandonedPendingClaim(createdAt, NOW), true);
});

test("isAbandonedPendingClaim is true well past the threshold", () => {
  const createdAt = new Date(NOW.getTime() - ABANDONED_CLAIM_THRESHOLD_MS * 5);
  assert.equal(isAbandonedPendingClaim(createdAt, NOW), true);
});

test("isAbandonedPendingClaim respects a custom threshold", () => {
  const createdAt = new Date(NOW.getTime() - 60_000);
  assert.equal(isAbandonedPendingClaim(createdAt, NOW, 30_000), true);
  assert.equal(isAbandonedPendingClaim(createdAt, NOW, 120_000), false);
});

test("ABANDONED_CLAIM_THRESHOLD_MS is comfortably above the route's 60s maxDuration", () => {
  assert.ok(ABANDONED_CLAIM_THRESHOLD_MS > 60_000);
});

test("abandonedClaimCutoff and isAbandonedPendingClaim never disagree (SQL cutoff <-> JS decision)", () => {
  const cutoff = abandonedClaimCutoff(NOW);
  // A row created exactly at the cutoff is not abandoned yet...
  assert.equal(isAbandonedPendingClaim(cutoff, NOW), false);
  // ...but one millisecond older than the cutoff is.
  assert.equal(isAbandonedPendingClaim(new Date(cutoff.getTime() - 1), NOW), true);
});

test("abandonedClaimCutoff never mutates its `now` input (pure planner)", () => {
  const now = new Date(NOW);
  const before = new Date(now);
  abandonedClaimCutoff(now);
  assert.deepEqual(now, before);
});
