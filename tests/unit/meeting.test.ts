/**
 * Unit tests for src/lib/contacts/meeting.ts — pure planner behind the
 * "Registrar reunión" quick action (task 10.2; design.md "meeting_logged
 * {at, notes}").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MeetingDateRequiredError, MeetingOccurredAtInFutureError, planMeeting } from "@/lib/contacts/meeting";
import { isBeyondClockSkew, FUTURE_CLOCK_SKEW_TOLERANCE_MS } from "@/lib/contacts/futureGuard";
import { planCall, CallOccurredAtInFutureError } from "@/lib/contacts/call";

// Fixed clock after every fixture date below, so these never go stale as the
// real calendar passes them (the future guard compares against `now`).
const AFTER_FIXTURES = new Date("2027-01-01T00:00:00.000Z");
const NOW = new Date("2026-09-26T15:00:00.000Z"); // 12:00 ART

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
  const plan = planMeeting("2026-10-21", "11:00", "", AFTER_FIXTURES);
  assert.equal(plan.at, "2026-10-21T14:00:00.000Z");
  assert.equal(plan.notes, null);
});

test("a missing time defaults to midnight ART (03:00 UTC)", () => {
  const plan = planMeeting("2026-10-21", "", "", AFTER_FIXTURES);
  assert.equal(plan.at, "2026-10-21T03:00:00.000Z");
});

test("notes are trimmed, blank collapses to null", () => {
  assert.equal(planMeeting("2026-10-21", "11:00", "  Talked about Q1  ", AFTER_FIXTURES).notes, "Talked about Q1");
  assert.equal(planMeeting("2026-10-21", "11:00", "   ", AFTER_FIXTURES).notes, null);
});

// --- F12: a future meeting is refused, one shared notion of "future" -------
// `person.status` is a cache recomputed only on writes and deriveStatus
// ignores metadata.at for meeting_logged, so a future meeting accepted now
// would never flip to "Reunión" once its date passed. Hence refuse.


test("a meeting more than 5 minutes ahead is rejected", () => {
  assert.throws(() => planMeeting("2026-09-26", "12:06", "", NOW), MeetingOccurredAtInFutureError);
  assert.throws(() => planMeeting("2026-09-30", "", "", NOW), MeetingOccurredAtInFutureError);
});

test("a meeting inside the skew tolerance or in the past is accepted", () => {
  assert.equal(planMeeting("2026-09-26", "12:05", "", NOW).at, "2026-09-26T15:05:00.000Z");
  assert.equal(planMeeting("2020-01-01", "10:00", "", NOW).at, "2020-01-01T13:00:00.000Z");
});

test("the meeting and call planners agree on the exact same boundary", () => {
  for (const time of ["12:05", "12:06"]) {
    const meetingRejects = (() => { try { planMeeting("2026-09-26", time, "", NOW); return false; } catch (e) { return e instanceof MeetingOccurredAtInFutureError; } })();
    const callRejects = (() => { try { planCall("connected", "outbound", "2026-09-26", time, "", NOW); return false; } catch (e) { return e instanceof CallOccurredAtInFutureError; } })();
    assert.equal(meetingRejects, callRejects, time);
  }
});

test("isBeyondClockSkew: exactly at the tolerance is not future, one ms past is", () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  assert.equal(isBeyondClockSkew(at(FUTURE_CLOCK_SKEW_TOLERANCE_MS), NOW), false);
  assert.equal(isBeyondClockSkew(at(FUTURE_CLOCK_SKEW_TOLERANCE_MS + 1), NOW), true);
});

test("planMeeting does not mutate its inputs and is repeatable", () => {
  const now = new Date(NOW.getTime());
  const a = planMeeting("2026-09-26", "11:00", "x", now);
  const b = planMeeting("2026-09-26", "11:00", "x", now);
  assert.deepEqual(a, b);
  assert.equal(now.getTime(), NOW.getTime());
});

// --- company dialog: typed reason instead of a raw English message ---------
import { meetingErrorReason } from "@/lib/contacts/meeting";

test("meetingErrorReason maps both meeting errors, and nothing else, to a typed reason", () => {
  assert.equal(meetingErrorReason(new MeetingDateRequiredError()), "meeting_date_required");
  assert.equal(meetingErrorReason(new MeetingOccurredAtInFutureError()), "meeting_occurred_at_in_future");
  assert.equal(meetingErrorReason(new Error("boom")), null);
  assert.equal(meetingErrorReason("nope"), null);
});

test("the company dialog's reason keys exist in both dictionaries with non-empty copy", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  const { es } = await import("@/lib/i18n/dictionaries/es");
  for (const d of [en, es]) {
    assert.ok(d.companyRecord.errorMeetingDateRequired.length > 0);
    assert.ok(d.companyRecord.errorMeetingOccurredAtInFuture.length > 0);
  }
  assert.notEqual(es.companyRecord.errorMeetingOccurredAtInFuture, en.companyRecord.errorMeetingOccurredAtInFuture);
});
