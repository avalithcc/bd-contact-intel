/**
 * Unit tests for src/lib/activity/conversationAudit.ts (task 11.3;
 * admin-access-audit spec "Admin conversation views are audit-logged" /
 * "No audit entry for own conversations"). Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAuditConversationView } from "@/lib/activity/conversationAudit";

test("an admin viewing another BD's conversation requires an audit entry", () => {
  assert.equal(shouldAuditConversationView("admin-bd", "other-bd"), true);
});

test("a BD viewing their own conversation does not require an audit entry", () => {
  assert.equal(shouldAuditConversationView("bd-a", "bd-a"), false);
});
