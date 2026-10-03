/**
 * Unit tests for src/lib/contacts/timelineGrouping.ts (mockup-port r03;
 * contact-record.html's "Próximas"/"{Mes}"/"Antes de la migración" timeline
 * groups).
 *
 * This module's own effective-time rule (formerly its own
 * `effectiveActivityAt`) was collapsed into the single
 * @/lib/contacts/effectiveActivityTime#resolveEffectiveActivityAt (one
 * name, one implementation) — that module's tests
 * (tests/unit/effectiveActivityTime.test.ts) pin the originalAt/createdAt
 * rule itself; this file only pins grouping/bucketing behavior built on top
 * of it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupTimelineEntries, upcomingTasks } from "@/lib/contacts/timelineGrouping";

test("groups entries into pre-migration vs. month buckets, matching the mockup's own example", () => {
  const entries = [
    { id: "a1", type: "email_sent", createdAt: new Date("2026-10-13T09:12:00Z"), metadata: {} },
    { id: "a2", type: "note", createdAt: new Date("2026-10-02T16:45:00Z"), metadata: { note: "x" } },
    {
      id: "a3",
      type: "status_backfill",
      createdAt: new Date("2026-10-06T03:10:00Z"),
      metadata: { status: "contacted", originalAt: "2026-06-02T00:00:00Z" },
    },
    { id: "a4", type: "hunter_lookup", createdAt: new Date("2026-08-20T00:00:00Z"), metadata: {} },
  ];
  const groups = groupTimelineEntries(entries);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, "month");
  assert.equal(groups[0].monthKey, "2026-10");
  assert.deepEqual(
    groups[0].items.map((i) => i.entry.id),
    ["a1", "a2"],
  );
  assert.equal(groups[1].kind, "pre-migration");
  assert.deepEqual(
    groups[1].items.map((i) => i.entry.id),
    ["a4", "a3"],
  );
});

test("upcomingTasks sorts dated tasks by soonest due date and keeps undated tasks after them", () => {
  const tasks = [
    { id: "t1", dueAt: new Date("2026-10-31T00:00:00Z") },
    { id: "t2", dueAt: null },
    { id: "t3", dueAt: new Date("2026-10-17T00:00:00Z") },
  ];
  const result = upcomingTasks(tasks);
  assert.deepEqual(
    result.map((t) => t.id),
    ["t3", "t1", "t2"],
  );
});

test("upcomingTasks keeps several undated tasks in their given order, and never reorders its input", () => {
  const tasks = [
    { id: "u1", dueAt: null },
    { id: "d1", dueAt: new Date("2026-10-31T00:00:00Z") },
    { id: "u2", dueAt: null },
  ];
  const snapshot = tasks.map((t) => t.id);
  const first = upcomingTasks(tasks).map((t) => t.id);
  const second = upcomingTasks(tasks).map((t) => t.id);
  assert.deepEqual(first, ["d1", "u1", "u2"]);
  assert.deepEqual(second, first);
  assert.deepEqual(tasks.map((t) => t.id), snapshot);
});
