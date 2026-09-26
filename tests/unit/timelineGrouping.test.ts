/**
 * Unit tests for src/lib/contacts/timelineGrouping.ts (mockup-port r03;
 * contact-record.html's "Próximas"/"{Mes}"/"Antes de la migración" timeline
 * groups).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveActivityAt, groupTimelineEntries, upcomingTasks } from "@/lib/contacts/timelineGrouping";

test("effectiveActivityAt uses status_backfill's metadata.originalAt, not createdAt", () => {
  const at = effectiveActivityAt({
    id: "a1",
    type: "status_backfill",
    createdAt: new Date("2026-10-06T03:10:00Z"),
    metadata: { status: "contacted", originalAt: "2026-06-02T00:00:00Z" },
  });
  assert.deepEqual(at, new Date("2026-06-02T00:00:00Z"));
});

test("effectiveActivityAt uses createdAt for every other type", () => {
  const createdAt = new Date("2026-10-13T09:12:00Z");
  const at = effectiveActivityAt({ id: "a1", type: "email_sent", createdAt, metadata: {} });
  assert.deepEqual(at, createdAt);
});

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

test("upcomingTasks sorts by soonest due date and drops tasks with no due date", () => {
  const tasks = [
    { id: "t1", dueAt: new Date("2026-10-31T00:00:00Z") },
    { id: "t2", dueAt: null },
    { id: "t3", dueAt: new Date("2026-10-17T00:00:00Z") },
  ];
  const result = upcomingTasks(tasks);
  assert.deepEqual(
    result.map((t) => t.id),
    ["t3", "t1"],
  );
});
