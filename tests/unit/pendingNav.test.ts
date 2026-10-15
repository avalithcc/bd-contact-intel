/**
 * Unit tests for src/lib/nav/pendingNav.ts — the sidebar's optimistic
 * "pending" highlight (Next 15.1 has no useLinkStatus, so the Sidebar tracks
 * the clicked item itself until usePathname() confirms the navigation).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isNavItemActive, shouldSetPending } from "@/lib/nav/pendingNav";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

test("shouldSetPending: plain left click to another route", () => {
  assert.equal(shouldSetPending(click, "/contacts", "/companies"), true);
});

test("shouldSetPending: modified clicks open a new tab and never set pending", () => {
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
    assert.equal(shouldSetPending({ ...click, [key]: true }, "/contacts", "/companies"), false, key);
  }
});

test("shouldSetPending: non-left button and prevented clicks are ignored", () => {
  assert.equal(shouldSetPending({ ...click, button: 1 }, "/contacts", "/companies"), false);
  assert.equal(shouldSetPending({ ...click, defaultPrevented: true }, "/contacts", "/companies"), false);
});

test("shouldSetPending: the exact route she is already on cannot stick", () => {
  assert.equal(shouldSetPending(click, "/companies", "/companies"), false);
});

test("shouldSetPending: from a record page, going back to its list is a real navigation", () => {
  assert.equal(shouldSetPending(click, "/companies/abc", "/companies"), true);
  assert.equal(shouldSetPending(click, "/contacts/abc", "/contacts"), true);
});

test("shouldSetPending: a nested admin path navigating to its own entry is a real navigation", () => {
  assert.equal(shouldSetPending(click, "/admin/reports/2026", "/admin/reports"), true);
  assert.equal(shouldSetPending(click, "/admin/reports", "/admin/reports"), false);
});

test("shouldSetPending: the target's query string is ignored when comparing routes", () => {
  assert.equal(shouldSetPending(click, "/contacts", "/contacts?view=outreach"), false);
  assert.equal(shouldSetPending(click, "/companies", "/contacts?view=outreach"), true);
});

test("isNavItemActive: pathname prefix when nothing is pending", () => {
  assert.equal(isNavItemActive("/companies/x", null, "/companies"), true);
  assert.equal(isNavItemActive("/companies", null, "/contacts"), false);
});

test("isNavItemActive: highlight moves to the pending item", () => {
  assert.equal(isNavItemActive("/contacts", "/companies", "/companies"), true);
  assert.equal(isNavItemActive("/contacts", "/companies", "/contacts"), false);
});

test("isNavItemActive: pending matches by item identity, not path", () => {
  assert.equal(isNavItemActive("/tasks", "/contacts?view=outreach", "/contacts?view=outreach"), true);
  assert.equal(isNavItemActive("/tasks", "/contacts?view=outreach", "/contacts"), false);
});
