import assert from "node:assert/strict";
import { test } from "node:test";
import { decideConnectionBanner, formatSince, type ConnectionBannerInput } from "@/lib/gmail/connectionBanner";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const READONLY = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";
const SEND_ONLY = "https://www.googleapis.com/auth/gmail.send";
const AUTH_ERROR = "Gmail authorization was revoked or expired";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

type Account = NonNullable<ConnectionBannerInput["account"]>;

function withAccount(over: Partial<Account> = {}): ConnectionBannerInput {
  return {
    account: { status: "connected", grantedScopes: READONLY, syncError: null, lastSyncedAt: hoursAgo(0.01), connectedAt: hoursAgo(500), ...over },
    now: NOW,
  };
}

test("disconnected account (status not connected) -> red disconnected", () => {
  assert.deepEqual(decideConnectionBanner(withAccount({ status: "disconnected" })), { tone: "danger", reason: "disconnected" });
  assert.deepEqual(decideConnectionBanner(withAccount({ status: "something-new" })), { tone: "danger", reason: "disconnected" });
});

test("a revoked token (send.ts sets status 'error') is 'expired' with since-when, not 'disconnected'", () => {
  const d = decideConnectionBanner(withAccount({ status: "error", lastSyncedAt: hoursAgo(3) }));
  assert.deepEqual(d, { tone: "danger", reason: "expired", sinceMs: 3 * 3_600_000 });
  assert.deepEqual(decideConnectionBanner(withAccount({ status: "revoked", lastSyncedAt: null })), { tone: "danger", reason: "expired", sinceMs: null });
});

test("no email_account row at all -> red disconnected", () => {
  assert.deepEqual(decideConnectionBanner({ account: null, now: NOW }), { tone: "danger", reason: "disconnected" });
});

test("failing + auth -> red expired carrying since-when", () => {
  const d = decideConnectionBanner(withAccount({ syncError: AUTH_ERROR, lastSyncedAt: hoursAgo(3) }));
  assert.deepEqual(d, { tone: "danger", reason: "expired", sinceMs: 3 * 3_600_000 });
});

test("failing + auth with no successful sync ever -> red expired without since", () => {
  const d = decideConnectionBanner(withAccount({ syncError: AUTH_ERROR, lastSyncedAt: null, connectedAt: hoursAgo(1) }));
  assert.deepEqual(d, { tone: "danger", reason: "expired", sinceMs: null });
});

test("connected without gmail.readonly -> red missing_scope", () => {
  assert.deepEqual(decideConnectionBanner(withAccount({ grantedScopes: SEND_ONLY })), { tone: "danger", reason: "missing_scope" });
  assert.deepEqual(decideConnectionBanner(withAccount({ grantedScopes: null })), { tone: "danger", reason: "missing_scope" });
});

test("missing scope is red even when a legacy dismissal timestamp is still on the row", () => {
  const input = { ...withAccount({ grantedScopes: SEND_ONLY }), reconnectBannerDismissedAt: new Date() } as ConnectionBannerInput;
  assert.equal(decideConnectionBanner(input)?.tone, "danger");
});

test("missing scope wins over a stale sync_error", () => {
  assert.equal(decideConnectionBanner(withAccount({ grantedScopes: SEND_ONLY, syncError: AUTH_ERROR }))?.reason, "missing_scope");
});

test("stale (no error, > 1h) -> amber stale", () => {
  assert.deepEqual(decideConnectionBanner(withAccount({ lastSyncedAt: hoursAgo(2) })), { tone: "warn", reason: "stale" });
});

test("healthy -> no banner", () => {
  assert.equal(decideConnectionBanner(withAccount()), null);
});

test("failing + config -> stays amber failing (reconnecting does not fix it)", () => {
  const d = decideConnectionBanner(withAccount({ syncError: "Gmail OAuth is misconfigured", lastSyncedAt: hoursAgo(0.1) }));
  assert.deepEqual(d, { tone: "warn", reason: "failing" });
});

test("failing + other: amber failing after the 30 min grace, nothing inside it", () => {
  const out = decideConnectionBanner(withAccount({ syncError: "Gmail API 500", lastSyncedAt: hoursAgo(1) }));
  assert.deepEqual(out, { tone: "warn", reason: "failing" });
  assert.equal(decideConnectionBanner(withAccount({ syncError: "Gmail API 500", lastSyncedAt: hoursAgo(0.1) })), null);
});

test("no decision carries a dismissible flag", () => {
  for (const d of [
    decideConnectionBanner({ account: null, now: NOW }),
    decideConnectionBanner(withAccount({ grantedScopes: SEND_ONLY })),
    decideConnectionBanner(withAccount({ lastSyncedAt: hoursAgo(2) })),
  ]) {
    assert.ok(d);
    assert.equal("dismissible" in d, false);
  }
});

test("formatSince phrases minutes, hours and days per locale", () => {
  assert.equal(formatSince(3 * 3_600_000, "es"), "hace 3 horas");
  assert.equal(formatSince(3 * 3_600_000, "en"), "3 hours ago");
  assert.equal(formatSince(10 * 60_000, "es"), "hace 10 minutos");
  assert.equal(formatSince(50 * 3_600_000, "es"), "hace 2 días");
});
