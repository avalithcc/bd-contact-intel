/**
 * New-email input guard behind sendContactEmailAction. A reply is exempt: its
 * subject is derived server-side (replySubject), the user never types it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateNewEmailInput } from "@/lib/contacts/newEmailInput";

test("rejects an empty subject", () => {
  assert.deepEqual(validateNewEmailInput("", "Hola"), { ok: false, reason: "email_subject_required" });
});

test("rejects a whitespace-only subject", () => {
  assert.deepEqual(validateNewEmailInput(" \t\n ", "Hola"), { ok: false, reason: "email_subject_required" });
});

test("rejects an empty or whitespace-only body", () => {
  assert.deepEqual(validateNewEmailInput("Hola", "  \n"), { ok: false, reason: "email_body_required" });
});

test("reports the subject first when both are empty", () => {
  assert.deepEqual(validateNewEmailInput("", ""), { ok: false, reason: "email_subject_required" });
});

test("accepts a valid subject and body, trimmed", () => {
  assert.deepEqual(validateNewEmailInput("  Squads  ", " Hola "), { ok: true, subject: "Squads", body: "Hola" });
});
