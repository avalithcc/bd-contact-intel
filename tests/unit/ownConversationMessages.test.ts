import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMessageDirection } from "@/lib/activity/messageDirection";

test("resolveMessageDirection: the peer's own profile key is 'received'", () => {
  assert.equal(resolveMessageDirection("peer-key", "peer-key"), "received");
});

test("resolveMessageDirection: the viewing BD's messages are 'sent'", () => {
  assert.equal(resolveMessageDirection("bd-key", "peer-key"), "sent");
});

test("resolveMessageDirection: an unattributed sender (InMail/company, null key) is 'sent'", () => {
  assert.equal(resolveMessageDirection(null, "peer-key"), "sent");
});
