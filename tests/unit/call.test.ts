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
