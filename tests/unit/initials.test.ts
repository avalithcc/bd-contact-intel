/**
 * Unit tests for src/components/initials.ts (tasks.md mockup-parity 3.2).
 * Pure function deriving the two-letter avatar initials shown in the shell
 * TopBar account menu trigger (design-system.html "Menú de cuenta",
 * `.avatar avatar-sm`) from a BD's display name.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { initialsFromName } from "@/components/initials";

test("initialsFromName takes the first letter of the first two words", () => {
  assert.equal(initialsFromName("Cristian Civita"), "CC");
});

test("initialsFromName uppercases the result", () => {
  assert.equal(initialsFromName("ana pereyra"), "AP");
});

test("initialsFromName takes the first two letters of a single-word name", () => {
  assert.equal(initialsFromName("Madonna"), "MA");
});

test("initialsFromName ignores extra whitespace between words", () => {
  assert.equal(initialsFromName("  Juan   Martínez  "), "JM");
});

test("initialsFromName falls back to a placeholder for an empty name", () => {
  assert.equal(initialsFromName(""), "?");
});
