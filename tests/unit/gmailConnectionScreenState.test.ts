import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveEmailConnectionScreenState } from "@/lib/gmail/connectionScreenState";

const noReconnectNeeded = () => false;
const reconnectNeeded = () => true;

test("no server OAuth config wins over everything else", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: false,
      accountStatus: "connected",
      grantedScopes: "gmail.readonly",
      syncError: null,
      backfillPageToken: null,
    },
    noReconnectNeeded,
  );
  assert.equal(state, "unavailable");
});

test("no row / not connected -> disconnected", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: true,
      accountStatus: null,
      grantedScopes: null,
      syncError: null,
      backfillPageToken: null,
    },
    noReconnectNeeded,
  );
  assert.equal(state, "disconnected");
});

test("connected but send-only scope -> needs_reconnect, even with a stale syncError", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: true,
      accountStatus: "connected",
      grantedScopes: "gmail.send",
      syncError: "stale error from before reconnect",
      backfillPageToken: "stale-token",
    },
    reconnectNeeded,
  );
  assert.equal(state, "needs_reconnect");
});

test("connected + readonly + syncError -> sync_error", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: true,
      accountStatus: "connected",
      grantedScopes: "gmail.readonly",
      syncError: "token revoked",
      backfillPageToken: null,
    },
    noReconnectNeeded,
  );
  assert.equal(state, "sync_error");
});

test("connected + readonly + backfillPageToken, no error -> backfilling", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: true,
      accountStatus: "connected",
      grantedScopes: "gmail.readonly",
      syncError: null,
      backfillPageToken: "abc123",
    },
    noReconnectNeeded,
  );
  assert.equal(state, "backfilling");
});

test("connected + readonly, no error, no backfill token -> synced", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: true,
      accountStatus: "connected",
      grantedScopes: "gmail.readonly",
      syncError: null,
      backfillPageToken: null,
    },
    noReconnectNeeded,
  );
  assert.equal(state, "synced");
});
