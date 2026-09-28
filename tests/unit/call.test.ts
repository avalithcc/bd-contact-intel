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

test("date + time combine into one ISO instant, used as occurredAt", () => {
  const plan = planCall("connected", "outbound", "2026-09-26", "14:30", "", "");
  assert.equal(plan.occurredAt, new Date("2026-09-26T14:30:00").toISOString());
});

test("a missing time defaults to midnight", () => {
  const plan = planCall("connected", "outbound", "2026-09-26", "", "", "");
  assert.equal(plan.occurredAt, new Date("2026-09-26T00:00:00").toISOString());
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

test("an occurredAt more than 5 minutes in the future is rejected", () => {
  const now = new Date("2026-09-26T12:00:00");
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
  const now = new Date("2026-09-26T12:00:00");
  const plan = planCall("connected", "outbound", "2026-09-26", "12:05", "", "", now);
  assert.equal(plan.occurredAt, new Date("2026-09-26T12:05:00").toISOString());
});

test("an occurredAt in the past is always accepted", () => {
  const now = new Date("2026-09-26T12:00:00");
  const plan = planCall("connected", "outbound", "2020-01-01", "00:00", "", "", now);
  assert.equal(plan.occurredAt, new Date("2020-01-01T00:00:00").toISOString());
});

test("a blank date (defaults to `now`) never trips the future guard", () => {
  const now = new Date("2026-09-26T12:00:00");
  const plan = planCall("connected", "outbound", "", "", "", "", now);
  assert.equal(plan.occurredAt, now.toISOString());
});
