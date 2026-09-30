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

/**
 * 11:00 ART = 14:00 UTC (fixed UTC-3 offset). Hardcoded, not computed via
 * `argentinaWallClockToUtc` itself (that would be tautological) — pins the
 * bug fix: `planMeeting` used to build `new Date` directly from the raw
 * strings, parsed as LOCAL time in the CALLING PROCESS's timezone (UTC on
 * Vercel), storing every meeting 3h off from what the BD entered. Must pass
 * under both `TZ=UTC` and `TZ=America/Argentina/Buenos_Aires`.
 */
test("date + time combine into one ISO instant, interpreted as Argentina wall-clock time", () => {
  const plan = planMeeting("2026-10-21", "11:00", "");
  assert.equal(plan.at, "2026-10-21T14:00:00.000Z");
  assert.equal(plan.notes, null);
});

test("a missing time defaults to midnight ART (03:00 UTC)", () => {
  const plan = planMeeting("2026-10-21", "", "");
  assert.equal(plan.at, "2026-10-21T03:00:00.000Z");
});

test("notes are trimmed, blank collapses to null", () => {
  assert.equal(planMeeting("2026-10-21", "11:00", "  Talked about Q1  ").notes, "Talked about Q1");
  assert.equal(planMeeting("2026-10-21", "11:00", "   ").notes, null);
});
