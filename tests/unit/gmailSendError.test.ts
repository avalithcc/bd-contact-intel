/**
 * Unit tests for src/lib/gmail/errors.ts#GmailSendError — the typed error
 * sendGmailMessage throws so callers can tell distinct Gmail failure causes
 * apart (fresh-review fix: sendContactEmailAction was collapsing every
 * Gmail failure to "unexpected", losing the actionable reconnect case).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { GmailSendError } from "@/lib/gmail/errors";

test("GmailSendError carries its kind and message", () => {
  const err = new GmailSendError("reauth_required", "Gmail authorization expired. Reconnect at /account/email.");
  assert.equal(err.kind, "reauth_required");
  assert.equal(err.message, "Gmail authorization expired. Reconnect at /account/email.");
  assert.equal(err.name, "GmailSendError");
});

test("GmailSendError is a real Error instance", () => {
  const err = new GmailSendError("not_connected", "Gmail account not connected. Connect it at /account/email.");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof GmailSendError);
});
