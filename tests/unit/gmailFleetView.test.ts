import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFleetRow,
  classifyAccount,
  countAttention,
  filterFleet,
  parseFleetFilter,
  summarizeFleet,
  type FleetAccount,
  type FleetRaw,
} from "@/lib/gmail/fleetView";
import { GMAIL_READONLY_SCOPE } from "@/lib/gmail/needsReconnectForSync";

// 10:44 ART on Friday 16 Oct 2026.
const NOW = new Date("2026-10-16T13:44:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const healthy = (over: Partial<FleetAccount> = {}): FleetAccount => ({
  status: "connected",
  grantedScopes: `x ${GMAIL_READONLY_SCOPE}`,
  syncError: null,
  lastSyncedAt: minutesAgo(2),
  connectedAt: daysAgo(30),
  hasCursor: true,
  backfilling: false,
  ...over,
});

function raw(over: Partial<FleetRaw> = {}): FleetRaw {
  return {
    bdId: "bd-1",
    name: "Lucía Ferrán",
    email: "lucia@bd.example",
    role: "bd",
    remindersEnabled: true,
    createdAt: daysAgo(90),
    lastSeenAt: minutesAgo(30),
    account: healthy(),
    sentReminders: [],
    lastEmail: { at: minutesAgo(13), direction: "inbound" },
    bouncesHard: 0,
    bouncesSoft: 0,
    failedSends: 0,
    lastFailedError: null,
    ...over,
  };
}

test("a connected account that synced two minutes ago is connected and ok", () => {
  const c = classifyAccount(healthy(), NOW);
  assert.equal(c.connection, "connected");
  assert.equal(c.reconnectReason, null);
  assert.equal(c.sync.state, "ok");
});

test("no email_account row is 'never'; a missing read scope, a revoked status and an auth error all need a reconnect", () => {
  assert.equal(classifyAccount(null, NOW).connection, "never");
  const scope = classifyAccount(healthy({ grantedScopes: "https://www.googleapis.com/auth/gmail.send" }), NOW);
  assert.deepEqual([scope.connection, scope.reconnectReason], ["reconnect", "missing_scope"]);
  const revoked = classifyAccount(healthy({ status: "revoked" }), NOW);
  assert.deepEqual([revoked.connection, revoked.reconnectReason], ["reconnect", "expired"]);
  const auth = classifyAccount(healthy({ syncError: "Gmail authorization was revoked", lastSyncedAt: minutesAgo(5) }), NOW);
  assert.deepEqual([auth.connection, auth.reconnectReason], ["reconnect", "expired"]);
});

test("a server-configuration error is its own connection state, because reconnecting does not fix it", () => {
  const c = classifyAccount(healthy({ syncError: "Gmail OAuth is misconfigured", lastSyncedAt: minutesAgo(1000) }), NOW);
  assert.equal(c.connection, "config");
  assert.equal(c.sync.state, "failing");
});

test("an unclassified error is tolerated for 30 minutes, then the connection stays authorized but the sync is failing", () => {
  assert.equal(classifyAccount(healthy({ syncError: "Gmail API returned 503", lastSyncedAt: minutesAgo(20) }), NOW).sync.state, "ok");
  const c = classifyAccount(healthy({ syncError: "Gmail API returned 503", lastSyncedAt: minutesAgo(151) }), NOW);
  assert.deepEqual([c.connection, c.sync.state, c.sync.errorKind], ["connected", "failing", "other"]);
});

test("no success for more than an hour with no error is stale", () => {
  const c = classifyAccount(healthy({ lastSyncedAt: minutesAgo(61) }), NOW);
  assert.deepEqual([c.connection, c.sync.state], ["connected", "stale"]);
});

test("the summary counts each BD once and attention is everything that is not healthy", () => {
  const rows = [
    raw({ bdId: "1" }),
    raw({ bdId: "2", account: healthy({ grantedScopes: "x" }) }),
    raw({ bdId: "3", account: healthy({ syncError: "Gmail API returned 503", lastSyncedAt: minutesAgo(151) }) }),
    raw({ bdId: "4", account: healthy({ syncError: "Gmail OAuth is misconfigured", lastSyncedAt: minutesAgo(900) }) }),
    raw({ bdId: "5", account: null }),
  ].map((r) => buildFleetRow(r, NOW));
  assert.deepEqual(summarizeFleet(rows), { total: 5, healthy: 1, reconnect: 1, failing: 2, never: 1, attention: 4 });
  assert.equal(filterFleet(rows, "attention").length, 4);
  assert.equal(filterFleet(rows, "healthy").length, 1);
  assert.equal(filterFleet(rows, "all").length, 5);
});

test("countAttention is the sidebar counter and agrees with the summary", () => {
  const accounts = [healthy(), healthy({ grantedScopes: "x" }), null, healthy({ lastSyncedAt: minutesAgo(90) })];
  assert.equal(countAttention(accounts, NOW), 3);
  assert.equal(countAttention([], NOW), 0);
});

test("parseFleetFilter falls back to all", () => {
  assert.equal(parseFleetFilter("attention"), "attention");
  assert.equal(parseFleetFilter("healthy"), "healthy");
  assert.equal(parseFleetFilter("nope"), "all");
  assert.equal(parseFleetFilter(undefined), "all");
});

test("reminder column: admins and healthy BDs get no reminder, with the reason the mockup gives", () => {
  assert.equal(buildFleetRow(raw({ role: "admin" }), NOW).reminder.kind, "admin");
  assert.equal(buildFleetRow(raw(), NOW).reminder.kind, "healthy");
  assert.equal(buildFleetRow(raw({ account: healthy({ syncError: "Gmail API returned 503", lastSyncedAt: minutesAgo(151) }) }), NOW).reminder.kind, "authorization_ok");
  assert.equal(buildFleetRow(raw({ account: healthy({ syncError: "Gmail OAuth is misconfigured", lastSyncedAt: minutesAgo(900) }) }), NOW).reminder.kind, "not_applicable");
  assert.equal(buildFleetRow(raw({ account: null, remindersEnabled: false }), NOW).reminder.kind, "disabled");
});

test("reminder series: 1 of 3 sent counts from the last visit and the next one is three business days after the last", () => {
  // Visit Wed 7 Oct; reminder #1 sent Fri 16 Oct 09:00 ART; next is Wed 21 Oct.
  const row = buildFleetRow(
    raw({ account: healthy({ grantedScopes: "x" }), lastSeenAt: new Date("2026-10-07T15:00:00Z"), sentReminders: [new Date("2026-10-02T12:00:00Z"), new Date("2026-10-16T12:00:00Z")] }),
    NOW,
  );
  assert.deepEqual(row.reminder, { kind: "series", sent: 1, lastOn: "2026-10-16", nextOn: "2026-10-21", spacingDays: 3, due: false, complete: false, baseKind: "seen", baseOn: "2026-10-07" });
  assert.equal(row.canSendReminder, true);
});

test("reminder series: a BD that never connected shows the first one two business days after sign-up (or last visit)", () => {
  const row = buildFleetRow(raw({ account: null, createdAt: new Date("2026-10-15T15:00:00Z"), lastSeenAt: null }), NOW);
  assert.deepEqual(row.reminder, { kind: "series", sent: 0, lastOn: null, nextOn: "2026-10-19", spacingDays: 2, due: false, complete: false, baseKind: "created", baseOn: "2026-10-15" });
});

test("reminder series: three sent is complete and offers no further send", () => {
  const sent = [new Date("2026-10-08T12:00:00Z"), new Date("2026-10-13T12:00:00Z"), new Date("2026-10-15T12:00:00Z")];
  const row = buildFleetRow(raw({ account: null, lastSeenAt: new Date("2026-10-01T12:00:00Z"), sentReminders: sent }), NOW);
  assert.equal(row.reminder.kind === "series" && row.reminder.complete, true);
  assert.equal(row.canSendReminder, false);
});

test("the send button is for non-admin BDs who need a reconnect or never connected, and only with reminders enabled", () => {
  const send = (over: Partial<FleetRaw>) => buildFleetRow(raw(over), NOW).canSendReminder;
  assert.equal(send({ account: null }), true);
  assert.equal(send({ account: healthy({ grantedScopes: "x" }) }), true);
  assert.equal(send({ account: null, role: "admin" }), false);
  assert.equal(send({ account: null, remindersEnabled: false }), false);
  assert.equal(send({}), false);
  assert.equal(send({ account: healthy({ syncError: "Gmail API returned 503", lastSyncedAt: minutesAgo(151) }) }), false);
  assert.equal(send({ account: healthy({ syncError: "Gmail OAuth is misconfigured", lastSyncedAt: minutesAgo(900) }) }), false);
});

test("a due reminder is flagged so the page can say it goes out on the next run", () => {
  const row = buildFleetRow(raw({ account: null, lastSeenAt: daysAgo(10) }), NOW);
  assert.equal(row.reminder.kind === "series" && row.reminder.due, true);
});
