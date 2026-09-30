/**
 * Unit tests for src/lib/pagination.ts (Registro de auditoría admin page —
 * admin-conversation-access mockup, screen 3). Pure — no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { paginationRange, resolvePage } from "@/lib/pagination";

test("resolvePage defaults to 1 for undefined/blank/non-numeric input", () => {
  assert.equal(resolvePage(undefined), 1);
  assert.equal(resolvePage(""), 1);
  assert.equal(resolvePage("abc"), 1);
});

test("resolvePage clamps below 1 up to 1", () => {
  assert.equal(resolvePage("0"), 1);
  assert.equal(resolvePage("-5"), 1);
});

test("resolvePage parses a valid page number", () => {
  assert.equal(resolvePage("3"), 3);
});

test("paginationRange computes totalPages, offset, and the 'showing X-Y of Z' range", () => {
  const r = paginationRange(2, 25, 60);
  assert.deepEqual(r, { totalPages: 3, offset: 25, from: 26, to: 50 });
});

test("paginationRange caps `to` at the true total on the last page", () => {
  const r = paginationRange(3, 25, 60);
  assert.deepEqual(r, { totalPages: 3, offset: 50, from: 51, to: 60 });
});

test("paginationRange with zero rows: totalPages is at least 1, from/to are both 0", () => {
  const r = paginationRange(1, 25, 0);
  assert.deepEqual(r, { totalPages: 1, offset: 0, from: 0, to: 0 });
});
