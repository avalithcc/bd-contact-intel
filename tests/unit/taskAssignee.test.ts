/**
 * Unit tests for src/lib/tasks/assignee.ts (task-essentials backlog item 2:
 * "let the creator pick any active BD, defaulting to themselves"). Pure —
 * reuses normalizeOwnerSelectValue's uuid validation (src/lib/contacts/
 * bulkOwner.ts), so a task assignee `<select>` follows the exact same
 * "blank or uuid, else reject" contract every owner `<select>` in this app
 * already follows. Unlike a Contact/Company owner, a task is never
 * "unassigned" — blank means "assign it to me", not null.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTaskAssignee } from "@/lib/tasks/assignee";

const CREATOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_BD_ID = "22222222-2222-4222-8222-222222222222";

test("resolveTaskAssignee defaults a blank selection to the creator", () => {
  assert.equal(resolveTaskAssignee("", CREATOR_ID), CREATOR_ID);
});

test("resolveTaskAssignee passes through a well-formed uuid unchanged", () => {
  assert.equal(resolveTaskAssignee(OTHER_BD_ID, CREATOR_ID), OTHER_BD_ID);
});

test("resolveTaskAssignee rejects a non-uuid value instead of silently defaulting", () => {
  assert.equal(resolveTaskAssignee("not-a-uuid", CREATOR_ID), undefined);
});

test("resolveTaskAssignee never mutates its inputs (pure)", () => {
  const before = { CREATOR_ID, OTHER_BD_ID };
  resolveTaskAssignee(OTHER_BD_ID, CREATOR_ID);
  assert.deepEqual({ CREATOR_ID, OTHER_BD_ID }, before);
});
