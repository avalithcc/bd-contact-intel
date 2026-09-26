/**
 * Unit tests for src/lib/uuid.ts — pure UUID shape check used before any
 * query against a `uuid` column, so a malformed route param (e.g.
 * `/contacts/not-a-uuid/conversation/also-not-a-uuid`, or a legacy
 * `/leads/[id]`/`/contact/[id]` id) answers 404 instead of crashing the DB
 * driver with "invalid input syntax for type uuid" (an uncaught 500 —
 * fresh-review BLOCKER on the admin conversation route).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isUuid } from "@/lib/uuid";

test("accepts a well-formed v4-shaped UUID", () => {
  assert.equal(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6"), true);
});

test("accepts uppercase hex", () => {
  assert.equal(isUuid("3FA85F64-5717-4562-B3FC-2C963F66AFA6"), true);
});

test("rejects a non-uuid string", () => {
  assert.equal(isUuid("not-a-uuid"), false);
});

test("rejects an empty string", () => {
  assert.equal(isUuid(""), false);
});

test("rejects a uuid missing a segment", () => {
  assert.equal(isUuid("3fa85f64-5717-4562-b3fc"), false);
});
