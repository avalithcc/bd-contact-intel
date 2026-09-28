/**
 * Unit tests for src/lib/contacts/views.ts — SYSTEM_VIEWS and
 * resolveActiveView. Pure filter-shape assertions, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSystemViewKey,
  resolveActiveView,
  systemViewFilters,
  SYSTEM_VIEWS,
} from "@/lib/contacts/views";

test("moveToEmail system view filters on contacted status + verified email, nothing else", () => {
  const view = SYSTEM_VIEWS.find((v) => v.key === "moveToEmail");
  assert.ok(view);
  assert.deepEqual(view.filters, { status: ["contacted"], emailVerified: true });
});

test("moveToEmail does not exclude hiring-only or any other ad-hoc filter (no extra keys)", () => {
  const view = SYSTEM_VIEWS.find((v) => v.key === "moveToEmail")!;
  assert.deepEqual(Object.keys(view.filters).sort(), ["emailVerified", "status"]);
});

test("isSystemViewKey recognizes moveToEmail", () => {
  assert.equal(isSystemViewKey("moveToEmail"), true);
});

test("systemViewFilters('moveToEmail') round-trips the same filters as the SYSTEM_VIEWS entry", () => {
  assert.deepEqual(systemViewFilters("moveToEmail"), { status: ["contacted"], emailVerified: true });
});

test("resolveActiveView('moveToEmail') resolves to the moveToEmail system view, not a saved view", () => {
  const active = resolveActiveView("moveToEmail", []);
  assert.equal(active.viewKey, "moveToEmail");
  assert.equal(active.isSaved, false);
  assert.deepEqual(active.filters, { status: ["contacted"], emailVerified: true });
});
