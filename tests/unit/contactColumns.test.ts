/**
 * Unit tests for src/lib/contacts/columns.ts (task 13.1; contact-list spec
 * "Column selection"; tasks.md "Column picker with persisted column
 * selection per view"). Pure sanitize/resolve pair — no DB — so a saved
 * view's `columns` jsonb and the picker's submitted form values never
 * drift from the same known-key set.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_CONTACT_COLUMNS,
  DEFAULT_CONTACT_COLUMNS,
  resolveVisibleColumns,
  sanitizeColumnKeys,
} from "@/lib/contacts/columns";

test("sanitizeColumnKeys keeps only known keys, dedups, preserves ALL_CONTACT_COLUMNS order", () => {
  const result = sanitizeColumnKeys(["email", "bogus", "company", "email", "owner"]);
  assert.deepEqual(result, ["company", "owner", "email"]);
});

test("sanitizeColumnKeys drops non-string entries and non-array input", () => {
  assert.deepEqual(sanitizeColumnKeys([1, null, "status", undefined]), ["status"]);
  assert.deepEqual(sanitizeColumnKeys("not-an-array"), []);
  assert.deepEqual(sanitizeColumnKeys(undefined), []);
});

test("sanitizeColumnKeys never includes the always-visible name column", () => {
  const result = sanitizeColumnKeys(["name", "company"]);
  assert.deepEqual(result, ["company"]);
});

test("resolveVisibleColumns falls back to DEFAULT_CONTACT_COLUMNS when given no valid selection", () => {
  assert.deepEqual(resolveVisibleColumns(undefined), DEFAULT_CONTACT_COLUMNS);
  assert.deepEqual(resolveVisibleColumns([]), DEFAULT_CONTACT_COLUMNS);
  assert.deepEqual(resolveVisibleColumns(["bogus"]), DEFAULT_CONTACT_COLUMNS);
});

test("resolveVisibleColumns honors a valid explicit selection, including a subset", () => {
  assert.deepEqual(resolveVisibleColumns(["status"]), ["status"]);
  assert.deepEqual(resolveVisibleColumns(["industry", "company"]), ["company", "industry"]);
});

test("ALL_CONTACT_COLUMNS contains every DEFAULT_CONTACT_COLUMNS entry", () => {
  for (const key of DEFAULT_CONTACT_COLUMNS) {
    assert.ok(ALL_CONTACT_COLUMNS.includes(key));
  }
});
