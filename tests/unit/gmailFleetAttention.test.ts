import assert from "node:assert/strict";
import { test } from "node:test";
import { gmailAttentionCount, type GmailFleetAccountJson } from "@/lib/gmail/fleetAttention";

const NOW = new Date("2026-10-16T13:44:00Z");
const READ = "https://www.googleapis.com/auth/gmail.readonly";
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const healthy: GmailFleetAccountJson = { has: true, status: "connected", grantedScopes: READ, syncError: null, lastSyncedAt: iso(2), connectedAt: iso(9000) };

test("no rows (a BD, or an empty fleet) means no pill", () => {
  assert.equal(gmailAttentionCount(null, NOW), 0);
  assert.equal(gmailAttentionCount([], NOW), 0);
});

test("ISO strings from json_agg are parsed: a healthy account does not count, a stale or reconnecting one does", () => {
  const stale = { ...healthy, lastSyncedAt: iso(90) };
  const noScope = { ...healthy, grantedScopes: "x" };
  assert.equal(gmailAttentionCount([healthy, stale, noScope], NOW), 2);
});

test("a BD with no account row counts (never connected); a connection error counts", () => {
  const never: GmailFleetAccountJson = { has: false, status: null, grantedScopes: null, syncError: null, lastSyncedAt: null, connectedAt: null };
  const failing = { ...healthy, syncError: "Gmail OAuth is misconfigured", lastSyncedAt: iso(900) };
  assert.equal(gmailAttentionCount([never, failing], NOW), 2);
});

test("it agrees with the fleet summary's idea of healthy: the same classifier decides both", () => {
  assert.equal(gmailAttentionCount([healthy, healthy], NOW), 0);
});
