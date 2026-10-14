import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DAILY_CREDIT_CAP,
  evaluateCap,
  getDailyCreditCap,
  getDailyCreditCapResolution,
  parseDailyCreditCap,
  resolveDailyCreditCap,
} from "../../src/lib/lusha/cap";

test("the default ceiling is 12", () => {
  assert.equal(DEFAULT_DAILY_CREDIT_CAP, 12);
});

test("unset or blank resolves to the default 12", () => {
  for (const raw of [undefined, "", "   "]) {
    assert.equal(parseDailyCreditCap(raw), 12, `raw=${String(raw)}`);
    assert.equal(resolveDailyCreditCap(raw).source, "default");
  }
});

test("a value that is set but unparsable resolves to 0, not the default", () => {
  for (const raw of ["abc", "-1", "NaN", "Infinity", "-Infinity", "1.5", "5.0", "1O", "12abc", "1e999"]) {
    assert.equal(parseDailyCreditCap(raw), 0, `raw=${raw}`);
    assert.equal(resolveDailyCreditCap(raw).source, "invalid", `raw=${raw}`);
  }
});

test("the invalid resolution carries a reason but never the raw value", () => {
  const r = resolveDailyCreditCap("secret-ish-1O");
  assert.deepEqual(r, { cap: 0, source: "invalid" });
  assert.ok(!JSON.stringify(r).includes("secret"));
  assert.deepEqual(getDailyCreditCapResolution({ LUSHA_DAILY_CREDIT_CAP: "abc" }), { cap: 0, source: "invalid" });
  assert.deepEqual(getDailyCreditCapResolution({}), { cap: 12, source: "default" });
});

test("zero is a valid soft kill switch", () => {
  assert.equal(parseDailyCreditCap("0"), 0);
});

test("a valid integer is honoured", () => {
  assert.equal(parseDailyCreditCap("50"), 50);
  assert.equal(parseDailyCreditCap(" 7 "), 7);
});

test("a parsed cap is always finite", () => {
  for (const raw of [undefined, "Infinity", "NaN", "1e999", "9".repeat(400)]) {
    assert.ok(Number.isFinite(parseDailyCreditCap(raw)), raw);
  }
});

test("exactly at the ceiling is allowed", () => {
  const r = evaluateCap({ spentToday: 10, cap: 12, expected: 2 });
  assert.deepEqual(r, { allowed: true, remaining: 2 });
});

test("one over the ceiling is refused", () => {
  const r = evaluateCap({ spentToday: 11, cap: 12, expected: 2 });
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 1);
});

test("a phone that does not fit is refused (8 of 12 used, expected 6)", () => {
  const r = evaluateCap({ spentToday: 8, cap: 12, expected: 6 });
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 4);
});

test("a 5-credit phone is refused after 8 spent of 12 (8 + 5 > 12)", () => {
  const r = evaluateCap({ spentToday: 8, cap: 12, expected: 5 });
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 4);
});

test("a 5-credit phone landing exactly on the ceiling is allowed (7 + 5 = 12)", () => {
  const r = evaluateCap({ spentToday: 7, cap: 12, expected: 5 });
  assert.deepEqual(r, { allowed: true, remaining: 5 });
});

test("a 5-credit phone fits after 4 spent of 12", () => {
  const r = evaluateCap({ spentToday: 4, cap: 12, expected: 5 });
  assert.deepEqual(r, { allowed: true, remaining: 8 });
});

test("the cap is global: spent is a team total, there is no per-BD input", () => {
  assert.deepEqual(evaluateCap({ spentToday: 10, cap: 12, expected: 2 }), { allowed: true, remaining: 2 });
});

test("a cap of 0 refuses everything", () => {
  const r = evaluateCap({ spentToday: 0, cap: 0, expected: 1 });
  assert.deepEqual(r, { allowed: false, remaining: 0 });
});

test("remaining never goes negative when the day is already over the cap", () => {
  const r = evaluateCap({ spentToday: 15, cap: 12, expected: 1 });
  assert.deepEqual(r, { allowed: false, remaining: 0 });
});

test("a free action (expected 0) is allowed even at the ceiling", () => {
  assert.equal(evaluateCap({ spentToday: 12, cap: 12, expected: 0 }).allowed, true);
});

test("getDailyCreditCap reads LUSHA_DAILY_CREDIT_CAP from the given env", () => {
  assert.equal(getDailyCreditCap({}), 12);
  assert.equal(getDailyCreditCap({ LUSHA_DAILY_CREDIT_CAP: "30" }), 30);
  assert.equal(getDailyCreditCap({ LUSHA_DAILY_CREDIT_CAP: "0" }), 0);
  assert.equal(getDailyCreditCap({ LUSHA_DAILY_CREDIT_CAP: "oops" }), 0);
});

test("evaluateCap fails closed on inputs that are not non-negative safe integers", () => {
  const bad: unknown[] = [null, undefined, "3", "0", -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY];
  const closed = { allowed: false, remaining: 0 };
  for (const v of bad) {
    const ctx = String(v);
    assert.deepEqual(evaluateCap({ spentToday: v as number, cap: 12, expected: 2 }), closed, `spentToday=${ctx}`);
    assert.deepEqual(evaluateCap({ spentToday: 0, cap: v as number, expected: 2 }), closed, `cap=${ctx}`);
    assert.deepEqual(evaluateCap({ spentToday: 0, cap: 12, expected: v as number }), closed, `expected=${ctx}`);
  }
});
