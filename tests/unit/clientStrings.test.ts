/**
 * Unit tests for src/lib/i18n/clientStrings.ts (tasks.md 8.5; design.md
 * D10). `assertClientStrings` is the runtime counterpart to the
 * `ClientStrings<T>` compile-time guard: it walks an actual dictionary
 * slice picked for a client component and throws if it finds anything
 * other than a string or a flat record of strings (e.g. a dictionary
 * formatter function). Passing a dictionary function to a client component
 * caused two production crashes — this test walks the real `es` dictionary
 * slices used today so a regression fails a fast unit test instead of
 * crashing in production.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertClientStrings } from "@/lib/i18n/clientStrings";
import { es } from "@/lib/i18n/dictionaries/es";
import { pickGenerateMessageLabels } from "@/lib/outreach/messageLabels";
import { pickLeadsUploadLabels, pickLeadEditLabels } from "@/lib/leads/labels";
import { pickNavLabels } from "@/lib/i18n/navLabels";

test("assertClientStrings accepts a plain string", () => {
  assert.doesNotThrow(() => assertClientStrings("hola"));
});

test("assertClientStrings accepts a flat record of strings", () => {
  assert.doesNotThrow(() => assertClientStrings({ new: "Nuevo", contacted: "Contactado" }));
});

test("assertClientStrings rejects a formatter function", () => {
  assert.throws(() => assertClientStrings({ searchChip: (q: string) => `Buscar: ${q}` }), TypeError);
});

test("assertClientStrings rejects a function nested two levels deep", () => {
  assert.throws(
    () => assertClientStrings({ home: { searchChip: (q: string) => q } }),
    TypeError,
  );
});

test("pickGenerateMessageLabels(es) is safe to pass to a client component", () => {
  assert.doesNotThrow(() => assertClientStrings(pickGenerateMessageLabels(es)));
});

test("pickLeadsUploadLabels(es) is safe to pass to a client component", () => {
  assert.doesNotThrow(() => assertClientStrings(pickLeadsUploadLabels(es)));
});

test("pickLeadEditLabels(es) is safe to pass to a client component", () => {
  assert.doesNotThrow(() => assertClientStrings(pickLeadEditLabels(es)));
});

test("pickNavLabels(es) is safe to pass to a client component", () => {
  assert.doesNotThrow(() => assertClientStrings(pickNavLabels(es)));
});

test("regression guard: the full dictionary is NOT client-safe (contains formatters)", () => {
  assert.throws(() => assertClientStrings(es), TypeError);
});
