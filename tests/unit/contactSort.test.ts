/**
 * Unit tests for src/lib/contacts/sort.ts — the `/contacts` table's two
 * sortable headers (mockups/contacts.html: "Nombre" and "Última actividad
 * ↓", the latter sorted by default — toolbar text "Ordenado por Última
 * actividad"). Pure query-param parsing only — no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTACT_SORT_KEYS, DEFAULT_CONTACT_SORT, parseContactSort } from "@/lib/contacts/sort";

test("parseContactSort defaults to lastActivity (mockup's default sort)", () => {
  assert.equal(parseContactSort(undefined), "lastActivity");
  assert.equal(DEFAULT_CONTACT_SORT, "lastActivity");
});

test("parseContactSort accepts 'name'", () => {
  assert.equal(parseContactSort("name"), "name");
});

test("parseContactSort rejects an unknown value, falling back to the default", () => {
  assert.equal(parseContactSort("bogus"), "lastActivity");
  assert.equal(parseContactSort(""), "lastActivity");
});

test("CONTACT_SORT_KEYS lists exactly the two sortable columns", () => {
  assert.deepEqual(CONTACT_SORT_KEYS, ["name", "lastActivity"]);
});
