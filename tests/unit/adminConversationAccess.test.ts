/**
 * Unit tests for src/lib/activity/adminConversationAccess.ts
 * (admin-conversation-access mockup, screen 1's "Ver conversación (queda
 * registrado)" action). Pure, no DB, no React.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { canShowAdminConversationAction } from "@/lib/activity/adminConversationAccess";

test("shows the action for an admin viewing a locked row with an owning BD", () => {
  assert.equal(
    canShowAdminConversationAction({ isAdmin: true, locked: true, targetBdId: "bd-a" }),
    true,
  );
});

test("hides the action for a non-admin, even on a locked row", () => {
  assert.equal(
    canShowAdminConversationAction({ isAdmin: false, locked: true, targetBdId: "bd-a" }),
    false,
  );
});

test("hides the action for an admin when the row isn't locked (their own conversation)", () => {
  assert.equal(
    canShowAdminConversationAction({ isAdmin: true, locked: false, targetBdId: "bd-a" }),
    false,
  );
});

test("hides the action when there is no owning BD to send the audited route to", () => {
  assert.equal(
    canShowAdminConversationAction({ isAdmin: true, locked: true, targetBdId: null }),
    false,
  );
});

test("hides the action for a non-admin on their own unlocked row (baseline no-op case)", () => {
  assert.equal(
    canShowAdminConversationAction({ isAdmin: false, locked: false, targetBdId: null }),
    false,
  );
});
