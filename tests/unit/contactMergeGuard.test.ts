/**
 * Unit tests for src/lib/contacts/mergeGuard.ts — the write guard for a
 * merged-away Contact (fresh-review WARNING: property edits and quick
 * actions had no merge guard, so a stale tab could silently write to a
 * losing person row instead of the survivor).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertContactEditable, ContactMergedError } from "@/lib/contacts/mergeGuard";

test("assertContactEditable allows a live (never-merged) contact", () => {
  assert.doesNotThrow(() => assertContactEditable({ mergedIntoId: null }));
});

test("assertContactEditable rejects a contact that was merged into another one", () => {
  assert.throws(
    () => assertContactEditable({ mergedIntoId: "22222222-2222-2222-2222-222222222222" }),
    ContactMergedError,
  );
});
