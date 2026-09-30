/**
 * Pure eligibility/ordering/worked-detection rules for the per-BD daily
 * follow-up queue (openspec/decisions/2026-09-30-decision-brief.md,
 * "1. Follow-up cadence — decided"; openspec/changes/follow-up-queue/
 * mockups/README.md). Schema-only-adjacent module (no `@/db` import), so
 * this stays runnable without a live DATABASE_URL — same convention as
 * src/lib/contacts/effectiveActivityTime.ts and
 * src/lib/companies/defaultPipelineStageQuery.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOLLOW_UP_CONTACTED_THRESHOLD_DAYS,
  FOLLOW_UP_DAILY_CAP,
  FOLLOW_UP_REPLIED_THRESHOLD_DAYS,
  FOLLOW_UP_RECENCY_MONTHS,
  isDueForFollowUp,
  isWithinRecencyWindow,
  selectFollowUpQueue,
  wasWorkedToday,
  type FollowUpCandidate,
} from "@/lib/followUp/queueSelection";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-29T15:00:00.000Z");
const BD_A = "bd-a";
const BD_B = "bd-b";

function daysAgo(days: number, from: Date = NOW): Date {
  return new Date(from.getTime() - days * MS_PER_DAY);
}

function candidate(overrides: Partial<FollowUpCandidate> = {}): FollowUpCandidate {
  return {
    personId: "p1",
    ownerBdId: BD_A,
    merged: false,
    status: "replied",
    lastTouchAt: daysAgo(FOLLOW_UP_REPLIED_THRESHOLD_DAYS),
    companyName: "Acme",
    snoozedUntil: null,
    ...overrides,
  };
}

test("isDueForFollowUp: replied is due at exactly 3 days, not at 2.9", () => {
  assert.equal(isDueForFollowUp("replied", daysAgo(FOLLOW_UP_REPLIED_THRESHOLD_DAYS), NOW), true);
  assert.equal(isDueForFollowUp("replied", daysAgo(2.9), NOW), false);
});

test("isDueForFollowUp: contacted is due at exactly 7 days, not at 6.9", () => {
  assert.equal(isDueForFollowUp("contacted", daysAgo(FOLLOW_UP_CONTACTED_THRESHOLD_DAYS), NOW), true);
  assert.equal(isDueForFollowUp("contacted", daysAgo(6.9), NOW), false);
});

test("isWithinRecencyWindow: exactly 12 months ago is still within the window, past it is not", () => {
  const exactly12MonthsAgo = new Date(NOW);
  exactly12MonthsAgo.setUTCMonth(exactly12MonthsAgo.getUTCMonth() - FOLLOW_UP_RECENCY_MONTHS);
  assert.equal(isWithinRecencyWindow(exactly12MonthsAgo, NOW), true);

  const justOverAYearAgo = new Date(exactly12MonthsAgo.getTime() - MS_PER_DAY);
  assert.equal(isWithinRecencyWindow(justOverAYearAgo, NOW), false);
});

test("selectFollowUpQueue: excludes contacts with no owner", () => {
  const candidates = [candidate({ personId: "p1", ownerBdId: null })];
  assert.deepEqual(selectFollowUpQueue(candidates, BD_A, NOW), []);
});

test("selectFollowUpQueue: excludes merged persons", () => {
  const candidates = [candidate({ personId: "p1", merged: true })];
  assert.deepEqual(selectFollowUpQueue(candidates, BD_A, NOW), []);
});

test("selectFollowUpQueue: excludes another BD's contacts", () => {
  const candidates = [candidate({ personId: "p1", ownerBdId: BD_B })];
  assert.deepEqual(selectFollowUpQueue(candidates, BD_A, NOW), []);
});

test("selectFollowUpQueue: excludes contacts last touched over 12 months ago", () => {
  const cutoff = new Date(NOW);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - FOLLOW_UP_RECENCY_MONTHS);
  const tooOld = new Date(cutoff.getTime() - MS_PER_DAY);
  const candidates = [candidate({ personId: "p1", lastTouchAt: tooOld })];
  assert.deepEqual(selectFollowUpQueue(candidates, BD_A, NOW), []);
});

test("selectFollowUpQueue: excludes contacts not yet due", () => {
  const candidates = [candidate({ personId: "p1", status: "replied", lastTouchAt: daysAgo(1) })];
  assert.deepEqual(selectFollowUpQueue(candidates, BD_A, NOW), []);
});

test("selectFollowUpQueue: excludes snoozed contacts (snoozedUntil in the future)", () => {
  const tomorrow = "2026-09-30";
  const candidates = [candidate({ personId: "p1", snoozedUntil: tomorrow })];
  assert.deepEqual(selectFollowUpQueue(candidates, BD_A, NOW), []);
});

test("selectFollowUpQueue: includes a contact once its snoozedUntil date has arrived", () => {
  const today = "2026-09-29";
  const candidates = [candidate({ personId: "p1", snoozedUntil: today })];
  const result = selectFollowUpQueue(candidates, BD_A, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.personId, "p1");
});

test("selectFollowUpQueue: orders replied before contacted", () => {
  const candidates = [
    candidate({ personId: "contacted-1", status: "contacted", lastTouchAt: daysAgo(FOLLOW_UP_CONTACTED_THRESHOLD_DAYS) }),
    candidate({ personId: "replied-1", status: "replied", lastTouchAt: daysAgo(FOLLOW_UP_REPLIED_THRESHOLD_DAYS) }),
  ];
  const result = selectFollowUpQueue(candidates, BD_A, NOW);
  assert.deepEqual(result.map((r) => r.personId), ["replied-1", "contacted-1"]);
});

test("selectFollowUpQueue: within the same status, most recent last touch first", () => {
  const candidates = [
    candidate({ personId: "older", status: "replied", lastTouchAt: daysAgo(10) }),
    candidate({ personId: "newer", status: "replied", lastTouchAt: daysAgo(3) }),
  ];
  const result = selectFollowUpQueue(candidates, BD_A, NOW);
  assert.deepEqual(result.map((r) => r.personId), ["newer", "older"]);
});

test("selectFollowUpQueue: ties on last-touch day are broken by company name ascending", () => {
  const sameTouch = daysAgo(3);
  const candidates = [
    candidate({ personId: "z-corp", status: "replied", lastTouchAt: sameTouch, companyName: "Zeta" }),
    candidate({ personId: "a-corp", status: "replied", lastTouchAt: sameTouch, companyName: "Acme" }),
  ];
  const result = selectFollowUpQueue(candidates, BD_A, NOW);
  assert.deepEqual(result.map((r) => r.personId), ["a-corp", "z-corp"]);
});

test("selectFollowUpQueue: caps at 10 even with more eligible contacts", () => {
  const candidates = Array.from({ length: 15 }, (_, i) =>
    candidate({ personId: `p${i}`, status: "replied", lastTouchAt: daysAgo(3 + i) }),
  );
  const result = selectFollowUpQueue(candidates, BD_A, NOW);
  assert.equal(result.length, FOLLOW_UP_DAILY_CAP);
  // Most recent (least days-ago) first, so the top 10 are p0..p9.
  assert.deepEqual(
    result.map((r) => r.personId),
    Array.from({ length: 10 }, (_, i) => `p${i}`),
  );
});

test("selectFollowUpQueue: assigns 1-based positions matching final order", () => {
  const candidates = [
    candidate({ personId: "first", status: "replied", lastTouchAt: daysAgo(5) }),
    candidate({ personId: "second", status: "contacted", lastTouchAt: daysAgo(7) }),
  ];
  const result = selectFollowUpQueue(candidates, BD_A, NOW);
  assert.deepEqual(
    result.map((r) => ({ personId: r.personId, position: r.position })),
    [
      { personId: "first", position: 1 },
      { personId: "second", position: 2 },
    ],
  );
});

test("selectFollowUpQueue: pure — never mutates its input, and calling it twice yields the same result", () => {
  const candidates = [
    candidate({ personId: "b", status: "replied", lastTouchAt: daysAgo(4), companyName: "Beta" }),
    candidate({ personId: "a", status: "replied", lastTouchAt: daysAgo(4), companyName: "Alpha" }),
  ];
  const snapshot = JSON.parse(JSON.stringify(candidates));

  const first = selectFollowUpQueue(candidates, BD_A, NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates)), snapshot, "input array must not be mutated");

  const second = selectFollowUpQueue(candidates, BD_A, NOW);
  assert.deepEqual(first, second, "calling the planner twice with the same input must yield the same result");
});

test("wasWorkedToday: true when a counted activity type was logged by this BD today (Argentina day)", () => {
  const activities = [{ type: "note", createdAt: new Date("2026-09-29T14:00:00.000Z"), actorBdId: BD_A }];
  assert.equal(wasWorkedToday(activities, BD_A, NOW), true);
});

test("wasWorkedToday: false when the activity was logged by a different BD", () => {
  const activities = [{ type: "note", createdAt: new Date("2026-09-29T14:00:00.000Z"), actorBdId: BD_B }];
  assert.equal(wasWorkedToday(activities, BD_A, NOW), false);
});

test("wasWorkedToday: false when the activity type doesn't count as work (e.g. hunter_lookup)", () => {
  const activities = [{ type: "hunter_lookup", createdAt: new Date("2026-09-29T14:00:00.000Z"), actorBdId: BD_A }];
  assert.equal(wasWorkedToday(activities, BD_A, NOW), false);
});

test("wasWorkedToday: false when the counted activity happened on a different Argentina calendar day", () => {
  // 2026-09-29T02:00:00.000Z is still 2026-09-28 in America/Argentina/Buenos_Aires (UTC-3).
  const activities = [{ type: "call", createdAt: new Date("2026-09-29T02:00:00.000Z"), actorBdId: BD_A }];
  assert.equal(wasWorkedToday(activities, BD_A, NOW), false);
});

test("wasWorkedToday: true for each of the five counted quick-action activity types", () => {
  for (const type of ["note", "call", "meeting_logged", "email_sent", "discarded"]) {
    const activities = [{ type, createdAt: new Date("2026-09-29T14:00:00.000Z"), actorBdId: BD_A }];
    assert.equal(wasWorkedToday(activities, BD_A, NOW), true, `expected "${type}" to count as worked`);
  }
});
