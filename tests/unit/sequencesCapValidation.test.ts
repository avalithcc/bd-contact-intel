import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAILY_SEND_CAP_CEILING,
  DAILY_SEND_CAP_DEFAULT,
  DAILY_SEND_CAP_WARN_ABOVE,
  validateDailySendCap,
} from "../../src/lib/sequences/capValidation";

test("constants match the owner's decision (default 5, ceiling 15, warn above 8)", () => {
  assert.equal(DAILY_SEND_CAP_DEFAULT, 5);
  assert.equal(DAILY_SEND_CAP_CEILING, 15);
  assert.equal(DAILY_SEND_CAP_WARN_ABOVE, 8);
});

test("an absent cap resolves to the default", () => {
  assert.deepEqual(validateDailySendCap(undefined), { ok: true, value: 5, warn: false });
  assert.deepEqual(validateDailySendCap(null), { ok: true, value: 5, warn: false });
});

test("accepts every integer from 1 to 15; warns only above 8", () => {
  for (let n = 1; n <= 15; n++) {
    assert.deepEqual(validateDailySendCap(n), { ok: true, value: n, warn: n > 8 }, `cap ${n}`);
  }
});

test("rejects zero, negatives, non-integers and anything above the ceiling", () => {
  for (const bad of [0, -3, 2.5, 16, 500]) {
    const r = validateDailySendCap(bad);
    assert.equal(r.ok, false, `cap ${bad}`);
  }
});

test("rejects NaN, infinities and non-number input", () => {
  for (const bad of [NaN, Infinity, -Infinity, "5", "", true, {}, []]) {
    assert.equal(validateDailySendCap(bad).ok, false, `cap ${String(bad)}`);
  }
});

test("a rejection names why", () => {
  const above = validateDailySendCap(500);
  assert.ok(!above.ok && above.reason === "above_ceiling");
  const low = validateDailySendCap(0);
  assert.ok(!low.ok && low.reason === "not_positive");
  const frac = validateDailySendCap(2.5);
  assert.ok(!frac.ok && frac.reason === "not_integer");
  const junk = validateDailySendCap("5");
  assert.ok(!junk.ok && junk.reason === "not_a_number");
});
