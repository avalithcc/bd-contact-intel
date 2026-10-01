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
      backfillPageToken: null,
    },
    noReconnectNeeded,
  );
  assert.equal(state, "disconnected");
});

test("connected but send-only scope -> needs_reconnect, even with a stale backfill token", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: true,
      accountStatus: "connected",
      grantedScopes: "gmail.send",
      backfillPageToken: "stale-token",
    },
    reconnectNeeded,
  );
  assert.equal(state, "needs_reconnect");
});

test("connected + readonly + backfillPageToken -> backfilling", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: true,
      accountStatus: "connected",
      grantedScopes: "gmail.readonly",
      backfillPageToken: "abc123",
    },
    noReconnectNeeded,
  );
  assert.equal(state, "backfilling");
});

test("connected + readonly, no backfill token -> synced", () => {
  const state = deriveEmailConnectionScreenState(
    {
      serverConfigured: true,
      accountStatus: "connected",
      grantedScopes: "gmail.readonly",
      backfillPageToken: null,
    },
    noReconnectNeeded,
  );
  assert.equal(state, "synced");
});
