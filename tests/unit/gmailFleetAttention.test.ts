import assert from "node:assert/strict";
import { test } from "node:test";
import { fleetAccountFromJson, gmailAttentionCount, type GmailFleetAccountJson } from "@/lib/gmail/fleetAttention";
import { buildFleetRow, summarizeFleet } from "@/lib/gmail/fleetView";

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

const never: GmailFleetAccountJson = { has: false, status: null, grantedScopes: null, syncError: null, lastSyncedAt: null, connectedAt: null };
const reconnect: GmailFleetAccountJson = { ...healthy, grantedScopes: "x" };
const config: GmailFleetAccountJson = { ...healthy, syncError: "Gmail OAuth is misconfigured", lastSyncedAt: iso(900) };
const stale: GmailFleetAccountJson = { ...healthy, lastSyncedAt: iso(90) };

/** What the fleet screen does with the same accounts: the real json mapper, then the real row builder, then the real summary. */
function fleetScreenAttention(rows: readonly GmailFleetAccountJson[]): number {
  const fleetRows = rows.map((r, i) =>
    buildFleetRow(
      {
        bdId: `bd-${i}`,
        name: `BD ${i}`,
        email: `bd${i}@example.test`,
        role: "bd",
        remindersEnabled: true,
        createdAt: new Date(iso(100_000)),
        lastSeenAt: null,
        account: fleetAccountFromJson(r),
        sentReminders: [],
        lastEmail: null,
        bouncesHard: 0,
        bouncesSoft: 0,
        failedSends: 0,
        lastFailedError: null,
      },
      NOW,
    ),
  );
  return summarizeFleet(fleetRows).attention;
}

test("the sidebar pill and the fleet summary count the same BDs as needing attention, over every mix of classifications", () => {
  const mixes: Record<string, GmailFleetAccountJson[]> = {
    "all healthy": [healthy, healthy],
    "all unhealthy, one of each kind": [never, reconnect, config, stale],
    "all never connected": [never, never, never],
    "all reconnect": [reconnect, reconnect],
    "all config error": [config, config],
    "all stale sync": [stale, stale],
    "one of each, healthy included": [healthy, never, reconnect, config, stale],
    "mostly healthy, one config error": [healthy, healthy, healthy, config],
    "mostly unhealthy, one healthy": [never, reconnect, config, stale, healthy],
  };
  for (const [label, rows] of Object.entries(mixes)) {
    assert.equal(gmailAttentionCount(rows, NOW), fleetScreenAttention(rows), label);
  }
  // Guard against both sides agreeing on a wrong constant: pin the two extremes.
  assert.equal(fleetScreenAttention([healthy, healthy]), 0);
  assert.equal(fleetScreenAttention([never, reconnect, config, stale]), 4);
});

test("bad data never throws: the pill falls back to 0 and the error is logged", () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    assert.equal(gmailAttentionCount({ not: "an array" } as unknown as GmailFleetAccountJson[], NOW), 0);
    assert.equal(logged.length, 1);
  } finally {
    console.error = original;
  }
});
