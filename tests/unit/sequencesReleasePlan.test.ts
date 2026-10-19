import assert from "node:assert/strict";
import { test } from "node:test";
import { planSequenceRelease, type PlanCandidate } from "@/lib/sequences/releasePlan";

// 2026-10-15 is EDT (UTC-4): 09:00 Miami = 13:00Z.
const NINE_AM = new Date("2026-10-15T13:00:00Z");
const RUN = new Date("2026-10-15T14:00:00Z"); // 10:00 Miami
const hour = (n: number) => new Date(NINE_AM.getTime() + n * 60 * 60 * 1000);

let seq = 0;
function cand(over: Partial<PlanCandidate> = {}): PlanCandidate {
  seq += 1;
  return {
    id: `m-${String(seq).padStart(3, "0")}`,
    accountId: "acc-1",
    sequenceId: "seq-1",
    dailyCap: 5,
    step: 1,
    dueAt: NINE_AM,
    approvedAt: new Date("2026-10-14T20:00:00Z"),
    ...over,
  };
}
const many = (n: number, over: Partial<PlanCandidate> = {}) => Array.from({ length: n }, () => cand(over));
const sent = (n: number, account = "acc-1") => new Map([[account, n]]);
const ids = (xs: readonly PlanCandidate[]) => xs.map((x) => x.id);

test("8 approved, cap 5, 0 sent: releases 5 and defers 3", () => {
  const c = many(8);
  const plan = planSequenceRelease({ now: RUN, candidates: c, sentToday: new Map() });
  assert.deepEqual(ids(plan.release), ids(c.slice(0, 5)));
  assert.deepEqual(ids(plan.deferred), ids(c.slice(5)));
});

test("cap already consumed: nothing is released, everything due is deferred", () => {
  const c = many(3);
  const plan = planSequenceRelease({ now: RUN, candidates: c, sentToday: sent(5) });
  assert.deepEqual(plan.release, []);
  assert.equal(plan.deferred.length, 3);
});

test("cap lowered mid-day below what is already sent: budget clamps at zero, never negative", () => {
  const c = many(2, { dailyCap: 2 });
  const plan = planSequenceRelease({ now: RUN, candidates: c, sentToday: sent(3) });
  assert.deepEqual(plan.release, []);
  assert.equal(plan.deferred.length, 2);
});

test("two Sequences on one account: the lower cap applies to the account's total", () => {
  const a = many(5, { sequenceId: "seq-a", dailyCap: 5 });
  const b = many(5, { sequenceId: "seq-b", dailyCap: 3 });
  const plan = planSequenceRelease({ now: RUN, candidates: [...a, ...b], sentToday: new Map() });
  assert.equal(plan.release.length, 3);
  assert.equal(plan.deferred.length, 7);
});

test("a Sequence with no due candidate does not lower the account's cap", () => {
  const a = many(5, { sequenceId: "seq-a", dailyCap: 5 });
  const future = cand({ sequenceId: "seq-b", dailyCap: 1, dueAt: hour(24) });
  const plan = planSequenceRelease({ now: RUN, candidates: [...a, future], sentToday: new Map() });
  assert.equal(plan.release.length, 5);
});

test("reminders share the cap: 3 reminders + 4 intros, cap 5, oldest due first", () => {
  const intros = [0, 1, 2, 3].map((n) => cand({ step: 1, dueAt: hour(n * 2) }));
  const reminders = [0, 1, 2].map((n) => cand({ step: 2, dueAt: hour(n * 2 + 1) }));
  const plan = planSequenceRelease({ now: hour(12), candidates: [...intros, ...reminders], sentToday: new Map() });
  const expected = [...intros, ...reminders].sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime());
  assert.deepEqual(ids(plan.release), ids(expected.slice(0, 5)));
  assert.deepEqual(ids(plan.deferred), ids(expected.slice(5)));
});

test("a failed attempt leaves the account with its whole budget (only recorded sends are counted)", () => {
  // The query counts outcome = 'sent' only (tests/db/sequenceRelease.test.ts proves it); a failure contributes no entry.
  const plan = planSequenceRelease({ now: RUN, candidates: many(5), sentToday: new Map() });
  assert.equal(plan.release.length, 5);
});

test("a run before 09:00 Miami releases no reminder, even one overdue from yesterday", () => {
  const overdue = cand({ step: 2, dueAt: new Date("2026-10-14T13:00:00Z") });
  const early = new Date("2026-10-15T12:00:00Z"); // 08:00 Miami
  const plan = planSequenceRelease({ now: early, candidates: [overdue], sentToday: new Map() });
  assert.deepEqual(plan.release, []);
  assert.deepEqual(ids(plan.deferred), [overdue.id]);
});

test("a step 1 the BD sent explicitly (now, or a chosen time) is NOT held by the floor: owner decision 2026-10-19", () => {
  const chosen = cand({ dueAt: new Date("2026-10-15T11:00:00Z") }); // 07:00 Miami
  const early = new Date("2026-10-15T11:30:00Z"); // 07:30 Miami
  const plan = planSequenceRelease({ now: early, candidates: [chosen], sentToday: new Map() });
  assert.deepEqual(ids(plan.release), [chosen.id]);
});

test("the daily cap still applies to an early explicit send", () => {
  const early = new Date("2026-10-15T11:30:00Z");
  const plan = planSequenceRelease({ now: early, candidates: many(3, { dueAt: new Date("2026-10-15T11:00:00Z"), dailyCap: 2 }), sentToday: new Map() });
  assert.equal(plan.release.length, 2);
  assert.equal(plan.deferred.length, 1);
});

test("09:00 Miami sharp releases; the floor follows DST (EST: 09:00 is 14:00Z)", () => {
  assert.equal(planSequenceRelease({ now: NINE_AM, candidates: many(1), sentToday: new Map() }).release.length, 1);
  const est = new Date("2026-11-02T14:00:00Z");
  const due = cand({ step: 2, dueAt: est });
  assert.equal(planSequenceRelease({ now: new Date("2026-11-02T13:30:00Z"), candidates: [due], sentToday: new Map() }).release.length, 0);
  assert.equal(planSequenceRelease({ now: est, candidates: [due], sentToday: new Map() }).release.length, 1);
});

test("a step that is not due yet is neither released nor deferred", () => {
  const notYet = cand({ dueAt: hour(5) });
  const plan = planSequenceRelease({ now: RUN, candidates: [notYet], sentToday: new Map() });
  assert.deepEqual(plan, { release: [], deferred: [] });
});

test("order: dueAt, then approvedAt, then id", () => {
  const late = cand({ id: "z", dueAt: hour(2) });
  const sameDueLaterApproval = cand({ id: "a", dueAt: hour(1), approvedAt: new Date("2026-10-14T22:00:00Z") });
  const sameDueEarlierApproval = cand({ id: "m", dueAt: hour(1), approvedAt: new Date("2026-10-14T21:00:00Z") });
  const tieB = cand({ id: "b", dueAt: hour(0) });
  const tieA = cand({ id: "a0", dueAt: hour(0) });
  const plan = planSequenceRelease({ now: hour(6), candidates: [late, sameDueLaterApproval, tieB, sameDueEarlierApproval, tieA], sentToday: new Map() });
  assert.deepEqual(ids(plan.release), ["a0", "b", "m", "a", "z"]);
});

test("each account has its own budget", () => {
  const one = many(4, { accountId: "acc-1" });
  const two = many(4, { accountId: "acc-2" });
  const plan = planSequenceRelease({ now: RUN, candidates: [...one, ...two], sentToday: new Map([["acc-1", 4], ["acc-2", 0]]) });
  assert.equal(plan.release.filter((c) => c.accountId === "acc-1").length, 1);
  assert.equal(plan.release.filter((c) => c.accountId === "acc-2").length, 4);
});

test("pure: the input is never mutated and a second call returns the same plan", () => {
  const input = {
    now: RUN,
    candidates: [cand({ dueAt: hour(2) }), cand({ dueAt: hour(1) }), ...many(6)].map((c) => Object.freeze(c)),
    sentToday: new Map([["acc-1", 1]]),
  };
  Object.freeze(input.candidates);
  const before = JSON.stringify(input.candidates);
  const first = planSequenceRelease(input);
  const second = planSequenceRelease(input);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(input.candidates), before);
  assert.deepEqual(input.sentToday, new Map([["acc-1", 1]]));
});
