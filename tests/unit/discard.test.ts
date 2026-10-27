/**
 * Unit tests for src/lib/contacts/discard.ts — pure planner behind the
 * "Descartar contacto" quick action (tasks 10.3/10.4; design.md "discarded
 * {reason, note (required when reason is `other`)}"; owner decision
 * 2026-09-24 for the fixed reason codes).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DISCARD_REASON_CODES,
  DISCARD_REASON_LABEL_KEY,
  DiscardNoteRequiredError,
  DiscardReasonRequiredError,
  discardReasonText,
  planDiscard,
} from "@/lib/contacts/discard";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

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

test("every discard code has a non-empty Spanish and English label, so a new code cannot reach the UI raw", () => {
  assert.deepEqual(Object.keys(DISCARD_REASON_LABEL_KEY).sort(), [...DISCARD_REASON_CODES].sort());
  for (const code of DISCARD_REASON_CODES) {
    const key = DISCARD_REASON_LABEL_KEY[code];
    for (const dict of [es, en]) {
      const label = dict.contactRecord[key];
      assert.ok(typeof label === "string" && label.trim().length > 0, `${code} -> ${key}`);
      assert.notEqual(label, code);
    }
  }
});

test("discardReasonText maps a code to its label and an unknown value to null, never to the raw value", () => {
  assert.equal(discardReasonText("wrong_profile", es.contactRecord), "No es el perfil adecuado");
  assert.equal(discardReasonText("not_a_real_code", es.contactRecord), null);
  assert.equal(discardReasonText(undefined, es.contactRecord), null);
  assert.equal(discardReasonText(42, es.contactRecord), null);
});
