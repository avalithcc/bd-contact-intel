import assert from "node:assert/strict";
import { test } from "node:test";
import { mostRecentActivity, touchpointTotal } from "@/lib/contacts/recentActivity";

test("mostRecentActivity returns null for an empty list", () => {
  assert.equal(mostRecentActivity([]), null);
});

test("mostRecentActivity picks the latest `at` across candidates", () => {
  const result = mostRecentActivity([
    { at: new Date("2026-10-01T00:00:00Z"), channelLabel: "Correo", actorName: "Cristian" },
    { at: new Date("2026-10-13T09:12:00Z"), channelLabel: "Correo", actorName: "Cristian" },
    { at: new Date("2026-10-05T00:00:00Z"), channelLabel: "LinkedIn", actorName: null },
  ]);
  assert.deepEqual(result, { at: new Date("2026-10-13T09:12:00Z"), channelLabel: "Correo", actorName: "Cristian" });
});

test("touchpointTotal sums every channel", () => {
  assert.equal(touchpointTotal({ linkedin: 6, email: 3, notes: 2 }), 11);
});
