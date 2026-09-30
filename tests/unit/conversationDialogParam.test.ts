import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveConversationDialogParam } from "@/lib/contacts/conversationDialogParam";

test("resolveConversationDialogParam: a well-formed uuid passes through", () => {
  assert.equal(
    resolveConversationDialogParam("11111111-1111-1111-1111-111111111111"),
    "11111111-1111-1111-1111-111111111111",
  );
});

test("resolveConversationDialogParam: an absent param (undefined) is null", () => {
  assert.equal(resolveConversationDialogParam(undefined), null);
});

test("resolveConversationDialogParam: an empty string is null", () => {
  assert.equal(resolveConversationDialogParam(""), null);
});

test("resolveConversationDialogParam: a malformed value is rejected, never reaching the DB", () => {
  assert.equal(resolveConversationDialogParam("not-a-uuid"), null);
  assert.equal(resolveConversationDialogParam("../../etc/passwd"), null);
});
