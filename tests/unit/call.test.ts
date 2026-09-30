/**
 * Unit tests for src/lib/contacts/call.ts — pure planner behind the
 * "Registrar llamada" quick action (contact-record mockup: outcome required,
 * direction, optional duration, notes). Mirrors meeting.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALL_OUTCOME_CODES,
  CALL_DIRECTIONS,
  CallOccurredAtInFutureError,
  CallOutcomeRequiredError,
  isCallOutcomeCode,
  isCallDirection,
  planCall,
} from "@/lib/contacts/call";

test("every outcome code is recognized", () => {
  for (const code of CALL_OUTCOME_CODES) assert.equal(isCallOutcomeCode(code), true);
  assert.equal(isCallOutcomeCode("connected_ish"), false);
});

test("every direction is recognized", () => {
  for (const dir of CALL_DIRECTIONS) assert.equal(isCallDirection(dir), true);
  assert.equal(isCallDirection("sideways"), false);
});

test("a missing outcome is rejected", () => {
  assert.throws(() => planCall("", "outbound", "2026-09-26", "14:30", "", ""), CallOutcomeRequiredError);
});

test("an unrecognized outcome is rejected", () => {
  assert.throws(() => planCall("levitated", "outbound", "2026-09-26", "14:30", "", ""), CallOutcomeRequiredError);
});

/**
 * 14:30 ART = 17:30 UTC (fixed UTC-3 offset). Hardcoded (not computed via
 * `argentinaWallClockToUtc` itself, which would make this tautological) so
 * this test actually pins the bug fix: `planCall` used to build
 * `new Date(\`${date}T${time}:00\`)` directly, which the JS spec parses as
 * LOCAL time in the CALLING PROCESS's timezone — passing on a dev laptop
 * set to ART, silently 3h wrong on a UTC server. Must pass under both
 * `TZ=UTC` and `TZ=America/Argentina/Buenos_Aires`.
 */
test("date + time combine into one ISO instant, used as occurredAt, interpreted as Argentina wall-clock time", () => {
  const plan = planCall("connected", "outbound", "2026-09-26", "14:30", "", "");
  assert.equal(plan.occurredAt, "2026-09-26T17:30:00.000Z");
});

test("a missing time defaults to midnight ART (03:00 UTC)", () => {
  const plan = planCall("connected", "outbound", "2026-09-26", "", "", "");
  assert.equal(plan.occurredAt, "2026-09-26T03:00:00.000Z");
});

test("a missing date defaults to now", () => {
  const before = Date.now();
  const plan = planCall("connected", "outbound", "", "", "", "");
  const at = new Date(plan.occurredAt).getTime();
  assert.ok(at >= before);
});

test("direction defaults to outbound when blank", () => {
  const plan = planCall("connected", "", "2026-09-26", "14:30", "", "");
  assert.equal(plan.direction, "outbound");
});

test("an unrecognized direction is treated as outbound (defensive default, same as blank)", () => {
  const plan = planCall("connected", "sideways", "2026-09-26", "14:30", "", "");
  assert.equal(plan.direction, "outbound");
});

test("duration is parsed as a non-negative integer of minutes, optional", () => {
  assert.equal(planCall("connected", "outbound", "2026-09-26", "14:30", "8", "").durationMinutes, 8);
  assert.equal(planCall("connected", "outbound", "2026-09-26", "14:30", "", "").durationMinutes, null);
  assert.equal(planCall("connected", "outbound", "2026-09-26", "14:30", "-5", "").durationMinutes, null);
  assert.equal(planCall("connected", "outbound", "2026-09-26", "14:30", "not a number", "").durationMinutes, null);
});

test("notes are trimmed, blank collapses to null", () => {
  assert.equal(planCall("connected", "outbound", "2026-09-26", "14:30", "", "  Great talk  ").notes, "Great talk");
  assert.equal(planCall("connected", "outbound", "2026-09-26", "14:30", "", "   ").notes, null);
});

// --- occurredAt must not be in the future (fresh-review WARNING fix) -------
// `now` fixtures are explicit UTC instants (Z-suffixed) so these tests never
// depend on the runner's own timezone either.

test("an occurredAt more than 5 minutes in the future is rejected", () => {
  const now = new Date("2026-09-26T15:00:00.000Z"); // 12:00 ART
  assert.throws(
    () => planCall("connected", "outbound", "2026-09-26", "12:06", "", "", now),
    CallOccurredAtInFutureError,
  );
  assert.throws(
    () => planCall("connected", "outbound", "2026-09-27", "00:00", "", "", now),
    CallOccurredAtInFutureError,
  );
});

test("an occurredAt within the 5-minute clock-skew tolerance is accepted", () => {
  const now = new Date("2026-09-26T15:00:00.000Z"); // 12:00 ART
  const plan = planCall("connected", "outbound", "2026-09-26", "12:05", "", "", now);
  assert.equal(plan.occurredAt, "2026-09-26T15:05:00.000Z"); // 12:05 ART
});

test("an occurredAt in the past is always accepted", () => {
  const now = new Date("2026-09-26T15:00:00.000Z"); // 12:00 ART
  const plan = planCall("connected", "outbound", "2020-01-01", "00:00", "", "", now);
  assert.equal(plan.occurredAt, "2020-01-01T03:00:00.000Z"); // 00:00 ART
});

test("a blank date (defaults to `now`) never trips the future guard", () => {
  const now = new Date("2026-09-26T15:00:00.000Z");
  const plan = planCall("connected", "outbound", "", "", "", "", now);
  assert.equal(plan.occurredAt, now.toISOString());
});
