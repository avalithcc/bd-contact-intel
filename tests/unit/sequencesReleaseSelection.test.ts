import assert from "node:assert/strict";
import { test } from "node:test";
import { pickReleaseKeys, releaseInstant, type SlimRow } from "@/lib/sequences/releaseSelection";
import { DEFAULT_SCHEDULE, reminderReleaseAt } from "@/lib/sequences/schedule";

const NOW = new Date("2026-10-15T14:00:00Z");

function reminder(id: string, reminderDueAt: string, approvedAt: string): SlimRow {
  return { id, step: 2, scheduledFor: null, reminderDueAt: new Date(reminderDueAt), approvedAt: new Date(approvedAt), schedule: DEFAULT_SCHEDULE };
}

// A has the EARLIER raw reminder_due_at but was approved late, so it only releases at the next 09:00 window (10-13);
// B is due later by raw value but was approved long before, so it releases at its due instant (10-11).
const A = reminder("a", "2026-10-10T13:00:00Z", "2026-10-12T20:00:00Z");
const B = reminder("b", "2026-10-11T13:00:00Z", "2026-10-09T20:00:00Z");

test("releaseInstant for a reminder IS reminderReleaseAt: the one expression behind both the ordering and the candidate", () => {
  assert.equal(releaseInstant(A).toISOString(), reminderReleaseAt(A.reminderDueAt!, A.approvedAt, A.schedule)!.toISOString());
  assert.equal(releaseInstant(A).toISOString(), "2026-10-13T13:00:00.000Z");
  assert.equal(releaseInstant(B).toISOString(), "2026-10-11T13:00:00.000Z");
});

test("the cap cuts by RELEASE instant, not by raw reminder_due_at: B outranks A although A's raw date is earlier", () => {
  const one = pickReleaseKeys([A, B], NOW, 1);
  assert.deepEqual(one.keys, [{ id: "b", step: 2 }]);
  assert.equal(one.truncated, true);
  const both = pickReleaseKeys([A, B], NOW, 2);
  assert.deepEqual(both.keys, [{ id: "b", step: 2 }, { id: "a", step: 2 }]);
  assert.equal(both.truncated, false);
});

test("a reminder whose raw due date has passed but whose release window has not is not a candidate and does not count toward truncation", () => {
  const early = reminder("c", "2026-10-10T13:00:00Z", "2026-10-15T12:00:00Z"); // approved 08:00 Miami today: releases at 09:00
  const result = pickReleaseKeys([early, B], new Date("2026-10-15T12:30:00Z"), 1);
  assert.deepEqual(result.keys, [{ id: "b", step: 2 }]);
  assert.equal(result.truncated, false);
});

test("step 1 releases at its stored scheduled_for", () => {
  const s1: SlimRow = { id: "s", step: 1, scheduledFor: new Date("2026-10-15T13:00:00Z"), reminderDueAt: null, approvedAt: new Date("2026-10-14T20:00:00Z"), schedule: DEFAULT_SCHEDULE };
  assert.equal(releaseInstant(s1).toISOString(), "2026-10-15T13:00:00.000Z");
});

test("not mutated: frozen rows, called twice, same result", () => {
  const rows = Object.freeze([Object.freeze({ ...A }), Object.freeze({ ...B })]) as readonly SlimRow[];
  const first = pickReleaseKeys(rows, NOW, 1);
  const second = pickReleaseKeys(rows, NOW, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"]);
});
