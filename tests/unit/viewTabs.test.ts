/**
 * Unit tests for src/lib/contacts/viewTabs.ts — the pure pinned/overflow
 * split behind the /contacts view-tabs overflow fix (owner-chosen option A):
 * a fixed set of pinned tabs, everything else in a "Más vistas" dropdown,
 * and the active view promoted into a visible tab after the pinned ones
 * when it lives in the dropdown (HubSpot-style), so the current view is
 * never hidden.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PINNED_VIEW_TAB_KEYS, splitViewTabs, type ViewTabItem } from "@/lib/contacts/viewTabs";

function tab(key: string, active = false): ViewTabItem {
  return { key, label: key, href: `/contacts?view=${key}`, active };
}

// Guards the owner's choice, so changing the pinned set must be deliberate.
// `outreachReady` was swapped for `moveToEmail` on 2026-09-28: measured against
// production, outreachReady held 22 contacts and moveToEmail held 3,460.
test("PINNED_VIEW_TAB_KEYS matches the owner-chosen pinned set", () => {
  assert.deepEqual(PINNED_VIEW_TAB_KEYS, ["all", "mine", "notContacted", "moveToEmail"]);
});

// The set stays at four: this row competes for horizontal width, and the bulk
// actions bar on the same page needed flex-wrap after overflowing at 1024px.
test("PINNED_VIEW_TAB_KEYS stays at four tabs", () => {
  assert.equal(PINNED_VIEW_TAB_KEYS.length, 4);
});

test("splitViewTabs: pinned tabs come first, in PINNED_VIEW_TAB_KEYS order, regardless of input order", () => {
  const items = [tab("notContacted"), tab("hiring"), tab("all"), tab("mine"), tab("moveToEmail")];
  const result = splitViewTabs(items);
  assert.deepEqual(
    result.pinned.map((t) => t.key),
    ["all", "mine", "notContacted", "moveToEmail"],
  );
});

test("splitViewTabs: everything not in PINNED_VIEW_TAB_KEYS goes to overflow, in input order", () => {
  const items = [tab("all"), tab("hiring"), tab("newVerified"), tab("outreach"), tab("saved:1")];
  const result = splitViewTabs(items);
  assert.deepEqual(
    result.overflow.map((t) => t.key),
    ["hiring", "newVerified", "outreach", "saved:1"],
  );
});

test("splitViewTabs: when the active view is pinned, activeOverflowItem is null (no duplicate tab)", () => {
  const items = [tab("all", true), tab("hiring")];
  const result = splitViewTabs(items);
  assert.equal(result.activeOverflowItem, null);
});

test("splitViewTabs: when the active view is in overflow, it is surfaced as activeOverflowItem so it's still visible as a tab", () => {
  const items = [tab("all"), tab("hiring", true), tab("saved:2")];
  const result = splitViewTabs(items);
  assert.equal(result.activeOverflowItem?.key, "hiring");
  // It still appears in `overflow` too (the dropdown still lists it).
  assert.ok(result.overflow.some((t) => t.key === "hiring"));
});

test("splitViewTabs: a pinned key missing from the input is simply omitted, not padded", () => {
  const items = [tab("all"), tab("mine")];
  const result = splitViewTabs(items);
  assert.deepEqual(
    result.pinned.map((t) => t.key),
    ["all", "mine"],
  );
});

test("splitViewTabs: no active item anywhere yields activeOverflowItem null", () => {
  const items = [tab("all"), tab("hiring")];
  const result = splitViewTabs(items);
  assert.equal(result.activeOverflowItem, null);
});
