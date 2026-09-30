/**
 * Unit tests for src/lib/gmail/truncateBodyText.ts (fresh-review fix,
 * 2026-09-30: cap the stored body at 256 KB).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { truncateBodyText, MAX_BODY_TEXT_BYTES } from "@/lib/gmail/truncateBodyText";

test("a short body is returned unchanged, truncated: false", () => {
  const result = truncateBodyText("hello");
  assert.equal(result.text, "hello");
  assert.equal(result.truncated, false);
});

test("a body over the byte cap is cut down to at most the cap, truncated: true", () => {
  const big = "a".repeat(MAX_BODY_TEXT_BYTES + 1000);
  const result = truncateBodyText(big);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.text, "utf8") <= MAX_BODY_TEXT_BYTES);
});

test("a body exactly at the cap is not truncated", () => {
  const exact = "a".repeat(MAX_BODY_TEXT_BYTES);
  const result = truncateBodyText(exact);
  assert.equal(result.truncated, false);
  assert.equal(result.text, exact);
});

test("truncation never leaves a trailing replacement character from a mid-codepoint cut", () => {
  // A multi-byte emoji repeated so the cap very likely lands mid-codepoint somewhere.
  const big = "😀".repeat(100_000);
  const result = truncateBodyText(big, 1000);
  assert.equal(result.truncated, true);
  assert.doesNotMatch(result.text, /�/);
});

test("respects a custom maxBytes for testing", () => {
  const result = truncateBodyText("hello world", 5);
  assert.equal(result.truncated, true);
  assert.equal(Buffer.byteLength(result.text, "utf8") <= 5, true);
});
