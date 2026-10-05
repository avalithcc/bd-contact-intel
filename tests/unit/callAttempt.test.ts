/**
 * Pure rules behind the tel: click that records a call attempt
 * (call-logging-one-tap, variant A).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALL_ATTEMPT_DEDUPE_WINDOW_MS,
  CALL_ATTEMPT_TYPE,
  dedupeCutoff,
  findDuplicateAttempt,
  planAttemptMetadata,
  planAttemptResolution,
  resolveDialledField,
  CallAttemptResolvedError,
} from "@/lib/contacts/callAttempt";
import { CallOutcomeRequiredError } from "@/lib/contacts/call";

const NOW = new Date("2026-10-05T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const dial = { bdId: "bd-1", number: "+54 9 11 5555-0142" };

test("the attempt is its own activity type, distinct from call", () => {
  assert.equal(CALL_ATTEMPT_TYPE, "call_attempt");
});

test("the dedupe window is 60 seconds and the cutoff is derived from it", () => {
  assert.equal(CALL_ATTEMPT_DEDUPE_WINDOW_MS, 60_000);
  assert.equal(dedupeCutoff(NOW).getTime(), NOW.getTime() - 60_000);
});

test("a second dial by the same BD to the same number inside the window is the same dial", () => {
  const recent = [{ id: "a1", actorBdId: "bd-1", number: dial.number, createdAt: ago(10_000) }];
  assert.equal(findDuplicateAttempt(recent, dial, NOW)?.id, "a1");
});

test("the window edge is inclusive; one millisecond past it is a new dial", () => {
  const edge = [{ id: "a1", actorBdId: "bd-1", number: dial.number, createdAt: ago(CALL_ATTEMPT_DEDUPE_WINDOW_MS) }];
  assert.equal(findDuplicateAttempt(edge, dial, NOW)?.id, "a1");
  const past = [{ id: "a2", actorBdId: "bd-1", number: dial.number, createdAt: ago(CALL_ATTEMPT_DEDUPE_WINDOW_MS + 1) }];
  assert.equal(findDuplicateAttempt(past, dial, NOW), null);
});

test("another number or another BD is a different dial", () => {
  const otherNumber = [{ id: "a1", actorBdId: "bd-1", number: "+54 11 4444-0000", createdAt: ago(5_000) }];
  assert.equal(findDuplicateAttempt(otherNumber, dial, NOW), null);
  const otherBd = [{ id: "a1", actorBdId: "bd-2", number: dial.number, createdAt: ago(5_000) }];
  assert.equal(findDuplicateAttempt(otherBd, dial, NOW), null);
});

test("the attempt records which number was dialled and in which field", () => {
  assert.deepEqual(planAttemptMetadata("  +54 9 11 5555-0142 ", "mobile_phone"), {
    number: "+54 9 11 5555-0142",
    field: "mobile_phone",
  });
});

test("confirming Hablé writes a call whose occurredAt is the DIAL moment, not now", () => {
  const dialledAt = new Date("2026-10-05T10:42:00.000Z");
  const plan = planAttemptResolution({ createdAt: dialledAt, metadata: { number: dial.number } }, "connected", " good chat ");
  assert.equal(plan.call?.occurredAt, "2026-10-05T10:42:00.000Z");
  assert.equal(plan.call?.outcome, "connected");
  assert.equal(plan.call?.direction, "outbound");
  assert.equal(plan.call?.notes, "good chat");
  assert.equal(plan.call?.number, dial.number);
  assert.deepEqual(plan.attemptPatch, { outcome: "connected" });
});

test("no_answer and voicemail close the attempt and write no call row", () => {
  for (const outcome of ["no_answer", "voicemail"]) {
    const plan = planAttemptResolution({ createdAt: ago(1000), metadata: {} }, outcome, "ignored note");
    assert.equal(plan.call, null);
    assert.deepEqual(plan.attemptPatch, { outcome });
  }
});

test("an unknown outcome is rejected and an already-answered attempt cannot be answered twice", () => {
  assert.throws(() => planAttemptResolution({ createdAt: ago(1000), metadata: {} }, "busy", ""), CallOutcomeRequiredError);
  assert.throws(
    () => planAttemptResolution({ createdAt: ago(1000), metadata: { outcome: "no_answer" } }, "connected", ""),
    CallAttemptResolvedError,
  );
});

test("the dialled field is whichever stored number matches, and a foreign number matches none", () => {
  const stored = { phone: "+54 11 4444-0000", mobilePhone: " +54 9 11 5555-0142" };
  assert.equal(resolveDialledField("+54 11 4444-0000", stored), "phone");
  assert.equal(resolveDialledField("+54 9 11 5555-0142", stored), "mobile_phone");
  assert.equal(resolveDialledField("+54 9 11 0000-0000", stored), null);
  assert.equal(resolveDialledField("  ", stored), null);
});
