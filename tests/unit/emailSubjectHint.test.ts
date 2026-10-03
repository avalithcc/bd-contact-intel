/**
 * Visibility rule for the "subject required" hint in the new-email dialog.
 * It must agree with the Send gate (trimmed subject and body).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldShowSubjectHint } from "@/lib/contacts/emailSubjectHint";

test("shows when the body has content and the subject is empty", () => {
  assert.equal(shouldShowSubjectHint("", "Hola"), true);
});

test("hides on a freshly opened dialog with both fields empty", () => {
  assert.equal(shouldShowSubjectHint("", ""), false);
});

test("hides when both fields are filled", () => {
  assert.equal(shouldShowSubjectHint("Squads", "Hola"), false);
});

test("shows when the subject is whitespace-only and the body has content", () => {
  assert.equal(shouldShowSubjectHint(" \t ", "Hola"), true);
});

test("hides when the body is whitespace-only and the subject is empty", () => {
  assert.equal(shouldShowSubjectHint("", " \n "), false);
});
