import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DAILY_CREDIT_CAP,
  DEFAULT_MONTHLY_CREDIT_CAP,
  evaluateCaps,
  getLushaLimits,
  lushaCycleWindow,
  planReservation,
  resolveCycleStartDay,
  resolveMonthlyCreditCap,
} from "../../src/lib/lusha/cap";

const iso = (d: Date) => d.toISOString();
const cycle = (now: string, day: number) => {
  const w = lushaCycleWindow(new Date(now), day);
  return [iso(w.start), iso(w.end)];
};
const PRICES = [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }];

test("defaults: 400 a month, 60 a day (a runaway rail, not a budget)", () => {
  assert.equal(DEFAULT_MONTHLY_CREDIT_CAP, 400);
  assert.equal(DEFAULT_DAILY_CREDIT_CAP, 60);
});

test("monthly cap resolves like the daily one: default, env, and invalid fails closed to 0", () => {
  assert.deepEqual(resolveMonthlyCreditCap(undefined), { cap: 400, source: "default" });
  assert.deepEqual(resolveMonthlyCreditCap("  "), { cap: 400, source: "default" });
  assert.deepEqual(resolveMonthlyCreditCap("250"), { cap: 250, source: "env" });
  assert.deepEqual(resolveMonthlyCreditCap("0"), { cap: 0, source: "env" });
  for (const raw of ["abc", "-1", "1.5", "4OO", "1e999"]) assert.deepEqual(resolveMonthlyCreditCap(raw), { cap: 0, source: "invalid" }, raw);
});

test("cycle start day: unset reports 'unset' (not 'default'), 1-28 are valid, everything else is invalid", () => {
  // `unset` is deliberately its own source: nothing is wrong with the value, it was never given -- and the two are
  // treated alike only at the point where it matters (getLushaLimits, below).
  assert.deepEqual(resolveCycleStartDay(undefined), { day: 1, source: "unset" });
  assert.deepEqual(resolveCycleStartDay(""), { day: 1, source: "unset" });
  for (const d of [1, 21, 28]) assert.deepEqual(resolveCycleStartDay(String(d)), { day: d, source: "env" });
  for (const raw of ["0", "29", "30", "31", "-1", "21.5", "abc", "32", "021x"]) assert.equal(resolveCycleStartDay(raw).source, "invalid", raw);
});

// The one failure in this module that would LOSE MONEY silently. If an unset cycle day fell back to the calendar
// month, the counter would reset on the 1st while Lusha does not replenish until the 21st, and the CRM would report a
// fresh allowance that does not exist. So ONLY an explicitly configured day enables the monthly budget; unset and
// invalid both kill it, exactly like every other value in this module. Do not "restore" a working default here.
test("only an EXPLICIT cycle start day enables the monthly cap: unset and invalid both kill it", () => {
  assert.deepEqual(getLushaLimits({}), { dailyCap: 60, monthlyCap: 0, cycleStartDay: 1 });
  assert.deepEqual(getLushaLimits({ LUSHA_CYCLE_START_DAY: "" }), { dailyCap: 60, monthlyCap: 0, cycleStartDay: 1 });
  assert.deepEqual(getLushaLimits({ LUSHA_CYCLE_START_DAY: "31" }), { dailyCap: 60, monthlyCap: 0, cycleStartDay: 1 });
  // A monthly cap set without a cycle day is still dead: the budget is meaningless without the window it applies to.
  assert.deepEqual(getLushaLimits({ LUSHA_MONTHLY_CREDIT_CAP: "400" }), { dailyCap: 60, monthlyCap: 0, cycleStartDay: 1 });
  // Configured, which is what production must look like.
  assert.deepEqual(getLushaLimits({ LUSHA_CYCLE_START_DAY: "21" }), { dailyCap: 60, monthlyCap: 400, cycleStartDay: 21 });
  assert.deepEqual(getLushaLimits({ LUSHA_CYCLE_START_DAY: "21", LUSHA_MONTHLY_CREDIT_CAP: "400", LUSHA_DAILY_CREDIT_CAP: "60" }), { dailyCap: 60, monthlyCap: 400, cycleStartDay: 21 });
});

test("cycle window: an instant before the start day belongs to the cycle that began last month", () => {
  assert.deepEqual(cycle("2026-10-05T15:00:00.000Z", 21), ["2026-09-21T03:00:00.000Z", "2026-10-21T03:00:00.000Z"]);
});

test("cycle window: on the start day (ART) the new cycle has begun", () => {
  assert.deepEqual(cycle("2026-10-21T03:00:00.000Z", 21), ["2026-10-21T03:00:00.000Z", "2026-11-21T03:00:00.000Z"]);
  assert.deepEqual(cycle("2026-10-20T23:59:59.999Z", 21), ["2026-09-21T03:00:00.000Z", "2026-10-21T03:00:00.000Z"]);
});

test("cycle window: after the start day it runs to the same day next month (worked example)", () => {
  assert.deepEqual(cycle("2026-11-05T12:00:00.000Z", 21), ["2026-10-21T03:00:00.000Z", "2026-11-21T03:00:00.000Z"]);
  // 1 November is NOT a reset: it is still the cycle that began on 21 October.
  assert.deepEqual(cycle("2026-11-01T12:00:00.000Z", 21), ["2026-10-21T03:00:00.000Z", "2026-11-21T03:00:00.000Z"]);
  assert.deepEqual(cycle("2026-11-21T12:00:00.000Z", 21), ["2026-11-21T03:00:00.000Z", "2026-12-21T03:00:00.000Z"]);
});

test("cycle window: a cycle spanning the year boundary, seen from both sides", () => {
  const expected = ["2026-12-21T03:00:00.000Z", "2027-01-21T03:00:00.000Z"];
  assert.deepEqual(cycle("2026-12-25T12:00:00.000Z", 21), expected);
  assert.deepEqual(cycle("2027-01-10T12:00:00.000Z", 21), expected);
  assert.deepEqual(cycle("2027-01-05T12:00:00.000Z", 1), ["2027-01-01T03:00:00.000Z", "2027-02-01T03:00:00.000Z"]);
});

test("cycle window: start day 1 is the calendar month, including December", () => {
  assert.deepEqual(cycle("2026-10-15T12:00:00.000Z", 1), ["2026-10-01T03:00:00.000Z", "2026-11-01T03:00:00.000Z"]);
  assert.deepEqual(cycle("2026-12-15T12:00:00.000Z", 1), ["2026-12-01T03:00:00.000Z", "2027-01-01T03:00:00.000Z"]);
});

test("cycle window: follows the Argentina day, not the UTC one (02:30Z is still yesterday in ART)", () => {
  assert.deepEqual(cycle("2026-11-21T02:30:00.000Z", 21), ["2026-10-21T03:00:00.000Z", "2026-11-21T03:00:00.000Z"]);
});

test("cycle window refuses a start day that could fall in a month without it", () => {
  for (const d of [0, 29, 30, 31, 1.5, Number.NaN]) assert.throws(() => lushaCycleWindow(new Date("2026-10-15T12:00:00.000Z"), d), RangeError, String(d));
});

test("cycle window: start 28 in February", () => {
  assert.deepEqual(cycle("2027-02-27T12:00:00.000Z", 28), ["2027-01-28T03:00:00.000Z", "2027-02-28T03:00:00.000Z"]);
});

const caps = { dailyCap: 60, monthlyCap: 400, actorSpentToday: 0, personalCap: null };

test("both caps pass: allowed, remaining is the tighter of the two", () => {
  assert.deepEqual(evaluateCaps({ spentToday: 10, spentCycle: 390 - 340, ...caps, expected: 5 }), { allowed: true, remaining: 50 });
  assert.deepEqual(evaluateCaps({ spentToday: 10, spentCycle: 390, ...caps, expected: 5 }), { allowed: true, remaining: 10 });
});

test("fits the daily cap but exceeds the monthly one: the monthly cap is named", () => {
  assert.deepEqual(evaluateCaps({ spentToday: 3, spentCycle: 398, ...caps, expected: 5 }), { allowed: false, blockedBy: "monthly", remaining: 2 });
});

test("fits the monthly cap but exceeds the daily one: the daily cap is named", () => {
  assert.deepEqual(evaluateCaps({ spentToday: 58, spentCycle: 100, ...caps, expected: 5 }), { allowed: false, blockedBy: "daily", remaining: 2 });
});

test("both exceeded: the monthly cap wins, because 'resets tomorrow' would be a lie", () => {
  const r = evaluateCaps({ spentToday: 60, spentCycle: 400, ...caps, expected: 1 });
  assert.deepEqual(r, { allowed: false, blockedBy: "monthly", remaining: 0 });
});

test("evaluateCaps fails closed on anything that is not a non-negative safe integer", () => {
  for (const bad of [null, undefined, "5", -1, 1.5, Number.NaN, Infinity]) {
    for (const key of ["spentToday", "spentCycle", "dailyCap", "monthlyCap", "expected"] as const) {
      const input = { spentToday: 0, spentCycle: 0, ...caps, expected: 1, [key]: bad };
      assert.deepEqual(evaluateCaps(input as never), { allowed: false, blockedBy: "monthly", remaining: 0 }, `${key}=${String(bad)}`);
    }
  }
});

test("planReservation: a phone that fits the day but not the month is refused by the monthly cap", () => {
  const r = planReservation({ field: "phones", canReveal: PRICES, spentToday: 3, spentCycle: 398, ...caps });
  assert.deepEqual(r, { ok: false, reason: "cap_exceeded", cap: "monthly", remaining: 2 });
});

test("planReservation: a phone that fits the month but not the day is refused by the daily cap", () => {
  const r = planReservation({ field: "phones", canReveal: PRICES, spentToday: 58, spentCycle: 100, ...caps });
  assert.deepEqual(r, { ok: false, reason: "cap_exceeded", cap: "daily", remaining: 2 });
});

test("planReservation: passes only when it fits under both", () => {
  assert.deepEqual(planReservation({ field: "phones", canReveal: PRICES, spentToday: 55, spentCycle: 395, ...caps }), { ok: true, credits: 5 });
  assert.equal(planReservation({ field: "emails", canReveal: PRICES, spentToday: "7" as never, spentCycle: 0, ...caps }).ok, false);
  assert.equal(planReservation({ field: "emails", canReveal: PRICES, spentToday: 0, spentCycle: null as never, ...caps }).ok, false);
});

test("planReservation: a kill-switch monthly cap of 0 refuses everything", () => {
  const r = planReservation({ field: "emails", canReveal: PRICES, spentToday: 0, spentCycle: 0, dailyCap: 60, monthlyCap: 0, actorSpentToday: 0, personalCap: null });
  assert.deepEqual(r, { ok: false, reason: "cap_exceeded", cap: "monthly", remaining: 0 });
});
