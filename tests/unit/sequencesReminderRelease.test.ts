import assert from "node:assert/strict";
import { test } from "node:test";
import { reminderReleaseAt } from "../../src/lib/sequences/schedule";

const iso = (d: Date | null) => d && d.toISOString();
// Reminder due 2026-10-21 at 09:00 Miami (13:00Z, EDT).
const due = new Date("2026-10-21T13:00:00Z");

test("approved at 08:00 Miami on the due day releases that day at 09:00", () => {
  assert.equal(iso(reminderReleaseAt(due, new Date("2026-10-21T12:00:00Z"))), "2026-10-21T13:00:00.000Z");
});

test("approved at 10:00 Miami on the due day waits for the next day 09:00", () => {
  assert.equal(iso(reminderReleaseAt(due, new Date("2026-10-21T14:00:00Z"))), "2026-10-22T13:00:00.000Z");
});

test("approved days before the due day still waits for the due instant", () => {
  assert.equal(iso(reminderReleaseAt(due, new Date("2026-10-15T20:00:00Z"))), "2026-10-21T13:00:00.000Z");
});

test("a reminder with no approval has no release instant, even when advanced to now", () => {
  assert.equal(reminderReleaseAt(new Date("2026-10-16T18:00:00Z"), null), null);
});

test("an advanced due date (now) is still held to the next 09:00 after approval", () => {
  const advanced = new Date("2026-10-16T18:00:00Z");
  assert.equal(iso(reminderReleaseAt(advanced, new Date("2026-10-16T18:05:00Z"))), "2026-10-17T13:00:00.000Z");
});
