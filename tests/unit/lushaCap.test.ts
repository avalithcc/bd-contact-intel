import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DAILY_CREDIT_CAP, evaluateCap, getDailyCreditCap, parseDailyCreditCap } from "../../src/lib/lusha/cap";

test("the default ceiling is 12", () => {
  assert.equal(DEFAULT_DAILY_CREDIT_CAP, 12);
});

test("unusable raw values fall back to the default", () => {
  for (const raw of [undefined, "", "   ", "abc", "-1", "NaN", "Infinity", "-Infinity", "1.5", "12abc"]) {
    assert.equal(parseDailyCreditCap(raw), 12, `raw=${String(raw)}`);
  }
});

test("zero is a valid soft kill switch", () => {
  assert.equal(parseDailyCreditCap("0"), 0);
});

test("a valid integer is honoured", () => {
  assert.equal(parseDailyCreditCap("50"), 50);
  assert.equal(parseDailyCreditCap(" 7 "), 7);
});

test("a parsed cap is always finite", () => {
  for (const raw of ["Infinity", "NaN", "1e999", "9".repeat(400)]) {
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
  assert.equal(getDailyCreditCap({ LUSHA_DAILY_CREDIT_CAP: "oops" }), 12);
});
