/**
 * /account and /account/email must never disagree about the Gmail row.
 * They used to: /account read only `email_account.status` and said
 * "Conectado", while /account/email first checked the server's OAuth config
 * and said "sin configurar" on the same deploy (every preview — the four
 * Google OAuth variables exist only in Production). Both pages now derive
 * their state from this one function.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gmailConnectionState } from "@/lib/gmail/connectionState";

test("missing server config wins over a stored connected account", () => {
  assert.equal(gmailConnectionState(false, "connected"), "unavailable");
});

test("missing server config with no account is unavailable, not disconnected", () => {
  assert.equal(gmailConnectionState(false, undefined), "unavailable");
});

test("configured and connected", () => {
  assert.equal(gmailConnectionState(true, "connected"), "connected");
});

test("configured but never connected, or in error, is disconnected", () => {
  assert.equal(gmailConnectionState(true, undefined), "disconnected");
  assert.equal(gmailConnectionState(true, null), "disconnected");
  assert.equal(gmailConnectionState(true, "error"), "disconnected");
});
