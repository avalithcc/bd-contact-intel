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

test("moveToEmail is retired as a system view: its population is the ready_for_email lane, one entry point only", () => {
  assert.equal(SYSTEM_VIEWS.some((v) => (v.key as string) === "moveToEmail"), false);
  assert.equal(isSystemViewKey("moveToEmail"), false);
  assert.deepEqual(systemViewFilters("moveToEmail" as never), {});
});

test("resolveActiveView('moveToEmail') no longer resolves to a system view (the page redirects it before this runs)", () => {
  const active = resolveActiveView("moveToEmail", []);
  assert.equal(active.viewKey, "all");
  assert.equal(active.isSaved, false);
});
