/**
 * Unit tests for src/lib/reports/discardReasons.ts — "Descartes por motivo".
 * Real production volume is near-zero (1 discard total as of 2026-09-30,
 * openspec/changes/owner-reporting/mockups/README.md), so this returns the
 * REAL per-code count for all 6 fixed codes (src/lib/contacts/discard.ts) —
 * a compact table, never a guessed/illustrative bucket (decision 3's table
 * alternative, chosen over the bar because the real per-period volume here
 * is too low for a percentage bar to mean anything).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DISCARD_REASON_CODES } from "@/lib/contacts/discard";
import { es } from "@/lib/i18n/dictionaries/es";
import { buildDiscardReasonRows, discardReasonLabel, totalDiscardCount } from "@/lib/reports/discardReasons";

test("buildDiscardReasonRows returns exactly the 6 fixed codes, in DISCARD_REASON_CODES order, even with zero rows", () => {
  const rows = buildDiscardReasonRows([]);
  assert.deepEqual(
    rows.map((r) => r.reason),
    [...DISCARD_REASON_CODES],
  );
  assert.ok(rows.every((r) => r.count === 0));
  assert.equal(rows.reduce((sum, r) => sum + r.count, 0), 0);
});

test("buildDiscardReasonRows fills in real counts from raw (reason,count) rows, unknown reasons dropped", () => {
  const rows = buildDiscardReasonRows([
    { reason: "wrong_profile", count: 1 },
    { reason: "some_legacy_value_not_in_the_fixed_list", count: 99 },
  ]);
  assert.equal(rows.find((r) => r.reason === "wrong_profile")!.count, 1);
  assert.equal(rows.reduce((sum, r) => sum + r.count, 0), 1, "an unrecognized reason code must not silently inflate the total");
});

test("buildDiscardReasonRows never mutates its input", () => {
  const input = [{ reason: "other", count: 2 }];
  const clone = JSON.parse(JSON.stringify(input));
  buildDiscardReasonRows(input);
  assert.deepEqual(input, clone);
});

test("discardReasonLabel reuses the exact labels the discard dialog itself shows", () => {
  assert.equal(discardReasonLabel("wrong_profile", es), es.contactRecord.discardReasonWrongProfile);
  assert.equal(discardReasonLabel("other", es), es.contactRecord.discardReasonOther);
});

test("totalDiscardCount sums every row", () => {
  const rows = buildDiscardReasonRows([{ reason: "wrong_profile", count: 1 }, { reason: "other", count: 1 }]);
  assert.equal(totalDiscardCount(rows), 2);
});
