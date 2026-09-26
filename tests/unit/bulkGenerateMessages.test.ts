/**
 * Unit tests for src/lib/contacts/bulkMessages.ts — the bulk "Generar
 * mensajes" bar action's id cap (mockups/contacts.html `.bulk-bar` "Generar
 * mensajes"; owner decision: smallest faithful version, capped at 25,
 * sequential — cap flagged in the checklist as needing owner confirmation).
 * Pure cap-and-flag only — no DB, no AI Gateway call.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { capBulkGenerateMessageIds, MAX_BULK_GENERATE_MESSAGES } from "@/lib/contacts/bulkMessages";

test("MAX_BULK_GENERATE_MESSAGES is 25 (owner decision, needs confirmation)", () => {
  assert.equal(MAX_BULK_GENERATE_MESSAGES, 25);
});

test("capBulkGenerateMessageIds passes a short selection through unchanged, not capped", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(capBulkGenerateMessageIds(ids), { ids, wasCapped: false });
});

test("capBulkGenerateMessageIds caps a longer selection at MAX_BULK_GENERATE_MESSAGES and flags it", () => {
  const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
  const result = capBulkGenerateMessageIds(ids);
  assert.equal(result.ids.length, 25);
  assert.deepEqual(result.ids, ids.slice(0, 25));
  assert.equal(result.wasCapped, true);
});

test("capBulkGenerateMessageIds at exactly the cap is not flagged as capped", () => {
  const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);
  assert.equal(capBulkGenerateMessageIds(ids).wasCapped, false);
});

test("capBulkGenerateMessageIds handles an empty selection", () => {
  assert.deepEqual(capBulkGenerateMessageIds([]), { ids: [], wasCapped: false });
});
