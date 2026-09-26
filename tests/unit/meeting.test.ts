/**
 * Unit tests for src/lib/contacts/meeting.ts — pure planner behind the
 * "Registrar reunión" quick action (task 10.2; design.md "meeting_logged
 * {at, notes}").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MeetingDateRequiredError, planMeeting } from "@/lib/contacts/meeting";

test("a missing date is rejected", () => {
  assert.throws(() => planMeeting("", "11:00", ""), MeetingDateRequiredError);
});

test("date + time combine into one ISO instant", () => {
  const plan = planMeeting("2026-10-21", "11:00", "");
  assert.equal(plan.at, new Date("2026-10-21T11:00:00").toISOString());
  assert.equal(plan.notes, null);
});

test("a missing time defaults to midnight", () => {
  const plan = planMeeting("2026-10-21", "", "");
  assert.equal(plan.at, new Date("2026-10-21T00:00:00").toISOString());
});

test("notes are trimmed, blank collapses to null", () => {
  assert.equal(planMeeting("2026-10-21", "11:00", "  Talked about Q1  ").notes, "Talked about Q1");
  assert.equal(planMeeting("2026-10-21", "11:00", "   ").notes, null);
});
