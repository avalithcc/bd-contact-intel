/**
 * Unit tests for src/lib/contacts/whatsapp.ts — pure planner behind the
 * "WhatsApp" quick action (whatsapp-como-actividad mockup: three outcomes,
 * date/time, notes; no direction control). Mirrors call.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isWhatsAppOutcomeCode,
  planWhatsApp,
  WHATSAPP_OUTCOME_CODES,
  WhatsAppOccurredAtInFutureError,
  WhatsAppOutcomeRequiredError,
} from "@/lib/contacts/whatsapp";

test("the three outcome codes are exactly sent, replied and no_whatsapp", () => {
  assert.deepEqual([...WHATSAPP_OUTCOME_CODES], ["sent", "replied", "no_whatsapp"]);
});

test("every outcome code is recognized and an unknown one is not", () => {
  for (const code of WHATSAPP_OUTCOME_CODES) assert.equal(isWhatsAppOutcomeCode(code), true);
  assert.equal(isWhatsAppOutcomeCode("connected"), false);
});

test("a blank outcome is rejected with WhatsAppOutcomeRequiredError", () => {
  assert.throws(() => planWhatsApp("", "2026-09-26", "14:30", ""), WhatsAppOutcomeRequiredError);
});

test("an outcome that is not one of the three codes is rejected with WhatsAppOutcomeRequiredError", () => {
  assert.throws(() => planWhatsApp("levitated", "2026-09-26", "14:30", ""), WhatsAppOutcomeRequiredError);
});

// 14:30 ART = 17:30 UTC. Hardcoded on purpose so the test does not reuse argentinaWallClockToUtc itself.
test("date and time are read as Argentina wall-clock and stored as a UTC ISO instant", () => {
  const plan = planWhatsApp("sent", "2026-09-26", "14:30", "");
  assert.equal(plan.occurredAt, "2026-09-26T17:30:00.000Z");
});

test("a date without a time defaults to midnight ART (03:00 UTC)", () => {
  const plan = planWhatsApp("sent", "2026-09-26", "", "");
  assert.equal(plan.occurredAt, "2026-09-26T03:00:00.000Z");
});

test("a blank date defaults occurredAt to the injected now", () => {
  const now = new Date("2026-10-28T15:00:00.000Z");
  const plan = planWhatsApp("replied", "", "", "", now);
  assert.equal(plan.occurredAt, "2026-10-28T15:00:00.000Z");
});

test("a date well after now is rejected with WhatsAppOccurredAtInFutureError", () => {
  const now = new Date("2026-10-28T15:00:00.000Z");
  assert.throws(() => planWhatsApp("sent", "2026-10-29", "10:00", "", now), WhatsAppOccurredAtInFutureError);
});

test("a date earlier than now is accepted", () => {
  const now = new Date("2026-10-28T15:00:00.000Z");
  assert.doesNotThrow(() => planWhatsApp("sent", "2026-10-27", "10:00", "", now));
});

test("notes are trimmed, and blank notes become null", () => {
  assert.equal(planWhatsApp("sent", "2026-09-26", "14:30", "  hola  ").notes, "hola");
  assert.equal(planWhatsApp("sent", "2026-09-26", "14:30", "   ").notes, null);
});

test("the plan carries the outcome and has no direction key", () => {
  const plan = planWhatsApp(" no_whatsapp ", "2026-09-26", "14:30", "");
  assert.equal(plan.outcome, "no_whatsapp");
  assert.equal("direction" in plan, false);
});
