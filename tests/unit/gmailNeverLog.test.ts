/**
 * Unit test for src/lib/gmail/neverLog.ts's pure normalizer. The DB
 * functions in that module are exercised indirectly by the sync route
 * (no DB access from tests — see CLAUDE.md).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeNeverLogValue, validateNeverLogInput } from "@/lib/gmail/neverLogRules";

test("normalizeNeverLogValue lowercases and trims an address", () => {
  assert.equal(normalizeNeverLogValue("address", "  Jane@Prospect.COM  "), "jane@prospect.com");
});

test("normalizeNeverLogValue strips a leading @ from a domain", () => {
  assert.equal(normalizeNeverLogValue("domain", "@Prospect.com"), "prospect.com");
});

test("normalizeNeverLogValue leaves a bare domain (no @) as-is, lowercased", () => {
  assert.equal(normalizeNeverLogValue("domain", "Prospect.COM"), "prospect.com");
});

// --- validateNeverLogInput (never-log settings screen, email-sync.html:315-319) ---

test("validateNeverLogInput rejects an empty/whitespace-only value", () => {
  assert.deepEqual(validateNeverLogInput("address", "   "), { ok: false, error: "empty" });
});

test("validateNeverLogInput accepts a well-formed address, normalized", () => {
  assert.deepEqual(validateNeverLogInput("address", "  Jane@Prospect.COM "), {
    ok: true,
    value: "jane@prospect.com",
  });
});

test("validateNeverLogInput rejects an address kind with no @", () => {
  assert.deepEqual(validateNeverLogInput("address", "not-an-email"), { ok: false, error: "invalid_address" });
});

test("validateNeverLogInput rejects an address kind with a bare domain value", () => {
  assert.deepEqual(validateNeverLogInput("address", "prospect.com"), { ok: false, error: "invalid_address" });
});

test("validateNeverLogInput accepts a well-formed domain, normalized", () => {
  assert.deepEqual(validateNeverLogInput("domain", "@Prospect.COM"), { ok: true, value: "prospect.com" });
});

test("validateNeverLogInput rejects a domain kind that contains an @ before the domain", () => {
  assert.deepEqual(validateNeverLogInput("domain", "jane@prospect.com"), { ok: false, error: "invalid_domain" });
});

test("validateNeverLogInput rejects a domain kind with no dot", () => {
  assert.deepEqual(validateNeverLogInput("domain", "localhost"), { ok: false, error: "invalid_domain" });
});
