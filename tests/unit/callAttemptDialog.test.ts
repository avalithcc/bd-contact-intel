/**
 * "Más detalles…" (click-to-call-log, option b): the full call form settles the
 * SAME attempt the tel: click recorded, so one call is one timeline row.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CallAttemptResolvedError, planAttemptCall } from "@/lib/contacts/callAttempt";
import { CallOccurredAtInFutureError, CallOutcomeRequiredError } from "@/lib/contacts/call";
import { callDialogDefaults, followUpTitle } from "@/lib/contacts/callDialog";

const NOW = new Date("2026-10-05T15:00:00.000Z");
const attempt = { createdAt: new Date("2026-10-05T14:00:00.000Z"), metadata: { number: "+5491141234567", field: "mobile_phone" } };

test("the dialog settles the attempt with ANY call outcome and writes one call carrying the dialled number", () => {
  const plan = planAttemptCall(attempt, { outcome: "busy", date: "2026-10-05", time: "11:30", notes: " hola " }, NOW);
  assert.deepEqual(plan.attemptPatch, { outcome: "busy" });
  assert.equal(plan.call.outcome, "busy");
  assert.equal(plan.call.direction, "outbound");
  assert.equal(plan.call.number, "+5491141234567");
  assert.equal(plan.call.notes, "hola");
  assert.equal(plan.call.occurredAt, "2026-10-05T14:30:00.000Z");
});

test("a blank date defaults to now, like the manual call form", () => {
  const plan = planAttemptCall(attempt, { outcome: "connected", date: "", time: "", notes: "" }, NOW);
  assert.equal(plan.call.occurredAt, NOW.toISOString());
  assert.equal(plan.call.notes, null);
});

test("the dialog rejects a missing outcome, a future time and an attempt that already has an outcome", () => {
  assert.throws(() => planAttemptCall(attempt, { outcome: "", date: "", time: "", notes: "" }, NOW), CallOutcomeRequiredError);
  assert.throws(
    () => planAttemptCall(attempt, { outcome: "connected", date: "2026-10-06", time: "11:00", notes: "" }, NOW),
    CallOccurredAtInFutureError,
  );
  assert.throws(
    () => planAttemptCall({ ...attempt, metadata: { outcome: "voicemail" } }, { outcome: "connected", date: "", time: "", notes: "" }, NOW),
    CallAttemptResolvedError,
  );
});

test("the dialog opens with now on the Argentina wall clock and a follow-up three days out", () => {
  assert.deepEqual(callDialogDefaults(new Date("2026-10-18T14:42:00.000Z")), { date: "2026-10-18", time: "11:42", followUpDue: "2026-10-21" });
});

test("the follow-up title is filled with the contact name", () => {
  assert.equal(followUpTitle("Llamar de nuevo a {name}", "Valentina Rojas"), "Llamar de nuevo a Valentina Rojas");
});
