/**
 * Unit tests for src/lib/dff2026/textClean.ts. Pure, no DB — run with:
 * npx tsx --test tests/unit/dff2026TextClean.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanField, stripControlChars } from "@/lib/dff2026/textClean";

test("stripControlChars removes a NUL byte embedded mid-string", () => {
  assert.equal(stripControlChars("Juan\x00 Perez"), "Juan Perez");
});

test("stripControlChars preserves tab/newline/carriage-return", () => {
  assert.equal(stripControlChars("a\tb\nc\r"), "a\tb\nc\r");
});

test("cleanField trims, strips control chars, and collapses blank to null", () => {
  assert.equal(cleanField("  Juan\x00  "), "Juan");
  assert.equal(cleanField("   "), null);
  assert.equal(cleanField(""), null);
  assert.equal(cleanField(undefined), null);
  assert.equal(cleanField(null), null);
});
