/**
 * Unit test for src/lib/gmail/neverLog.ts's pure normalizer. The DB
 * functions in that module are exercised indirectly by the sync route
 * (no DB access from tests — see CLAUDE.md).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeNeverLogValue } from "@/lib/gmail/neverLogRules";

test("normalizeNeverLogValue lowercases and trims an address", () => {
  assert.equal(normalizeNeverLogValue("address", "  Jane@Prospect.COM  "), "jane@prospect.com");
});

test("normalizeNeverLogValue strips a leading @ from a domain", () => {
  assert.equal(normalizeNeverLogValue("domain", "@Prospect.com"), "prospect.com");
});

test("normalizeNeverLogValue leaves a bare domain (no @) as-is, lowercased", () => {
  assert.equal(normalizeNeverLogValue("domain", "Prospect.COM"), "prospect.com");
});
