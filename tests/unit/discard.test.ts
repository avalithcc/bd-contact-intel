/**
 * Unit tests for src/lib/contacts/discard.ts — pure planner behind the
 * "Descartar contacto" quick action (tasks 10.3/10.4; design.md "discarded
 * {reason, note (required when reason is `other`)}"; owner decision
 * 2026-09-24 for the fixed reason codes).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DiscardNoteRequiredError,
  DiscardReasonRequiredError,
  planDiscard,
} from "@/lib/contacts/discard";

test("missing reason is rejected", () => {
  assert.throws(() => planDiscard(null, ""), DiscardReasonRequiredError);
});

test("an unrecognized reason code is rejected", () => {
  assert.throws(() => planDiscard("not_a_real_code", ""), DiscardReasonRequiredError);
});

test("reason 'other' without a note is rejected", () => {
  assert.throws(() => planDiscard("other", "   "), DiscardNoteRequiredError);
});

test("reason 'other' with a note is accepted", () => {
  const plan = planDiscard("other", "  Retired from the industry  ");
  assert.deepEqual(plan, { reason: "other", note: "Retired from the industry" });
});

test("a fixed reason other than 'other' does not require a note", () => {
  const plan = planDiscard("wrong_profile", "");
  assert.deepEqual(plan, { reason: "wrong_profile", note: null });
});

test("a fixed reason other than 'other' still records a note when given one", () => {
  const plan = planDiscard("not_interested", "Said so on a call");
  assert.deepEqual(plan, { reason: "not_interested", note: "Said so on a call" });
});
