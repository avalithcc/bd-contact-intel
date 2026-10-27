/**
 * follow-up-expiry: the pure cycle rules. The clock counts calendar days since the contact FIRST ENTERED the queue in the
 * current cycle (never since the last touch): days 0-2 are normal, 3-9 are Vencido, day 10 is the automatic drop.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { TIMELINE_PILL_GROUPS } from "@/lib/activity/timelinePills";
import { NON_TOUCH_ACTIVITY_TYPES } from "@/lib/contacts/effectiveActivityTime";
import {
  FOLLOW_UP_ACTIVITY_TYPES,
  FOLLOW_UP_DROPPED_TYPE,
  FOLLOW_UP_EXPIRED_TYPE,
  FOLLOW_UP_REENTERED_TYPE,
} from "@/lib/followUp/activityTypes";
import {
  buildDroppedMetadata,
  buildExpiredMetadata,
  classifyQueueItems,
  cycleStage,
  daysInQueue,
  daysOverdue,
  daysUntilExpiry,
  expiryDate,
  formatCycleDate,
  parseDropInput,
  type QueueItemForClassify,
} from "@/lib/followUp/cycle";
import { WORKED_ACTIVITY_TYPES } from "@/lib/followUp/queueSelection";
import { STATUS_NEUTRAL_ACTIVITY_TYPES } from "@/lib/status/deriveStatus";

test("daysInQueue counts calendar days from the cycle start, across month ends", () => {
  assert.equal(daysInQueue("2026-10-27", "2026-10-27"), 0);
  assert.equal(daysInQueue("2026-10-18", "2026-10-27"), 9);
  assert.equal(daysInQueue("2026-10-28", "2026-11-03"), 6);
});

test("cycleStage: 0-2 normal, 3-9 overdue, 10+ expired", () => {
  const stages = [0, 1, 2, 3, 9, 10, 11].map(cycleStage);
  assert.deepEqual(stages, ["normal", "normal", "normal", "overdue", "overdue", "expired", "expired"]);
});

test("daysOverdue is days in the queue minus 2 (day 3 reads 'vencido hace 1 d'), never negative", () => {
  assert.equal(daysOverdue(3), 1);
  assert.equal(daysOverdue(9), 7);
  assert.equal(daysOverdue(1), 0);
});

test("the drop date is the entry date plus 10 days and the countdown matches the mockup", () => {
  assert.equal(expiryDate("2026-10-18"), "2026-10-28");
  assert.equal(daysUntilExpiry("2026-10-18", "2026-10-27"), 1);
  assert.equal(daysUntilExpiry("2026-10-20", "2026-10-27"), 3);
  assert.equal(daysUntilExpiry("2026-10-23", "2026-10-27"), 6);
});

test("parseDropInput requires a known reason and a detail only for 'other'", () => {
  assert.deepEqual(parseDropInput("no_response", ""), { ok: true, reason: "no_response", detail: null });
  assert.deepEqual(parseDropInput("not_now", "  vuelve en enero "), { ok: true, reason: "not_now", detail: "vuelve en enero" });
  assert.deepEqual(parseDropInput("other", "   "), { ok: false, error: "detail_required" });
  assert.deepEqual(parseDropInput("other", "cambió de rubro"), { ok: true, reason: "other", detail: "cambió de rubro" });
  assert.deepEqual(parseDropInput("", ""), { ok: false, error: "reason_required" });
  assert.deepEqual(parseDropInput("wrong_profile", ""), { ok: false, error: "reason_required" });
  assert.deepEqual(parseDropInput(undefined, undefined), { ok: false, error: "reason_required" });
});

test("parseDropInput caps the detail length", () => {
  assert.deepEqual(parseDropInput("other", "x".repeat(501)), { ok: false, error: "detail_too_long" });
});

test("activity metadata carries the cycle entry date", () => {
  assert.deepEqual(buildDroppedMetadata({ reason: "other_bd", detail: null, cycleStartedOn: "2026-10-20", status: "replied" }), {
    reason: "other_bd",
    detail: null,
    cycleStartedOn: "2026-10-20",
    status: "replied",
  });
  assert.deepEqual(buildExpiredMetadata("2026-10-17", "2026-10-27", "contacted"), {
    cycleStartedOn: "2026-10-17",
    daysInQueue: 10,
    status: "contacted",
  });
  assert.equal(formatCycleDate("2026-10-07"), "7 oct");
});

type TestItem = QueueItemForClassify & { id: string };

function item(over: Partial<QueueItemForClassify> & { id: string }): TestItem {
  return { queueDate: "2026-10-27", cycleStartedOn: "2026-10-27", position: 1, ...over };
}

test("classifyQueueItems splits Hoy from Vencidos, orders Vencidos closest-to-drop first and hides expired", () => {
  const items = [
    item({ id: "new-1", position: 1 }),
    item({ id: "v-day4", queueDate: "2026-10-23", cycleStartedOn: "2026-10-23", position: 2 }),
    item({ id: "v-day9", queueDate: "2026-10-18", cycleStartedOn: "2026-10-18", position: 3 }),
    item({ id: "v-day7", queueDate: "2026-10-20", cycleStartedOn: "2026-10-20", position: 1 }),
    item({ id: "carried-day1", queueDate: "2026-10-26", cycleStartedOn: "2026-10-26", position: 1 }),
    item({ id: "expired-day10", queueDate: "2026-10-17", cycleStartedOn: "2026-10-17", position: 1 }),
    item({ id: "new-2", position: 2 }),
  ];
  const out = classifyQueueItems(items, "2026-10-27");
  assert.deepEqual(out.overdue.map((i) => i.id), ["v-day9", "v-day7", "v-day4"]);
  assert.deepEqual(out.today.map((i) => i.id), ["carried-day1", "new-1", "new-2"]);
  assert.deepEqual(
    out.overdue.map((i) => [i.daysInQueue, i.daysOverdue, i.expiresOn]),
    [
      [9, 7, "2026-10-28"],
      [7, 5, "2026-10-30"],
      [4, 2, "2026-11-02"],
    ],
  );
});

test("a legacy row without a cycle date is never overdue: it is today's row on its own day", () => {
  const out = classifyQueueItems([item({ id: "legacy", queueDate: "2026-10-27", cycleStartedOn: null })], "2026-10-27");
  assert.deepEqual(out.today.map((i) => i.id), ["legacy"]);
  assert.equal(out.overdue.length, 0);
});

test("classifyQueueItems never mutates its input and is repeatable", () => {
  const items = [
    item({ id: "b", queueDate: "2026-10-20", cycleStartedOn: "2026-10-20" }),
    item({ id: "a", queueDate: "2026-10-18", cycleStartedOn: "2026-10-18" }),
  ];
  const snapshot = JSON.parse(JSON.stringify(items));
  const first = classifyQueueItems(items, "2026-10-27");
  const second = classifyQueueItems(items, "2026-10-27");
  assert.deepEqual(items, snapshot);
  assert.deepEqual(first, second);
});

test("the three follow-up activity types never count as a touch, as progress, as work or as a status change", () => {
  assert.deepEqual([...FOLLOW_UP_ACTIVITY_TYPES].sort(), [FOLLOW_UP_DROPPED_TYPE, FOLLOW_UP_EXPIRED_TYPE, FOLLOW_UP_REENTERED_TYPE].sort());
  for (const type of FOLLOW_UP_ACTIVITY_TYPES) {
    assert.ok((NO_PROGRESS_ACTIVITY_TYPES as readonly string[]).includes(type), `${type} must not reset the cadence or move the owner`);
    assert.ok((NON_TOUCH_ACTIVITY_TYPES as readonly string[]).includes(type), `${type} must not be Ultima actividad`);
    assert.ok((STATUS_NEUTRAL_ACTIVITY_TYPES as readonly string[]).includes(type), `${type} must not move the pipeline stage`);
    assert.ok(!WORKED_ACTIVITY_TYPES.has(type), `${type} is not work`);
    assert.ok(TIMELINE_PILL_GROUPS.system.includes(type), `${type} belongs to the Sistema pill`);
  }
});
