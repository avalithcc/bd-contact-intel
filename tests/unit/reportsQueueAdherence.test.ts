/**
 * Unit tests for src/lib/reports/queueAdherence.ts — "Adherencia a la cola
 * de seguimientos". `worked`+`postponed`+`skipped` sum to `assigned` by
 * construction (every follow_up_queue_item row is in exactly one of the
 * three buckets for a completed day: pending-but-worked counts as
 * "worked", pending-and-not-worked is not shown as a separate bucket in
 * this card per the mockup — see the doc comment for the exact rule).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQueueAdherenceRow } from "@/lib/reports/queueAdherence";

test("buildQueueAdherenceRow computes adherencePct as worked ÷ assigned", () => {
  const row = buildQueueAdherenceRow({ worked: 38, postponed: 7, skipped: 5, stillPending: 0 });
  assert.equal(row.assigned, 50);
  assert.equal(row.adherencePct, 76);
});

test("buildQueueAdherenceRow's assigned counts stillPending too (a day not yet acted on shouldn't inflate the rate)", () => {
  const row = buildQueueAdherenceRow({ worked: 10, postponed: 0, skipped: 0, stillPending: 10 });
  assert.equal(row.assigned, 20);
  assert.equal(row.adherencePct, 50);
});

test("buildQueueAdherenceRow never divides by zero: zero assigned yields 0%, not NaN", () => {
  const row = buildQueueAdherenceRow({ worked: 0, postponed: 0, skipped: 0, stillPending: 0 });
  assert.equal(row.assigned, 0);
  assert.equal(row.adherencePct, 0);
});

test("buildQueueAdherenceRow's bar segment widths (worked/postponed/skipped) are each a percentage of assigned", () => {
  const row = buildQueueAdherenceRow({ worked: 38, postponed: 7, skipped: 5, stillPending: 0 });
  assert.equal(row.workedPct, 76);
  assert.equal(row.postponedPct, 14);
  assert.equal(row.skippedPct, 10);
});

test("buildQueueAdherenceRow never mutates its input", () => {
  const input = { worked: 1, postponed: 1, skipped: 1, stillPending: 1 };
  const clone = { ...input };
  buildQueueAdherenceRow(input);
  assert.deepEqual(input, clone);
});
