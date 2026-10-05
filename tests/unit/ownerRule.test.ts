/**
 * Unit tests for src/lib/identity/ownerRule.ts: the "owner is whoever worked
 * the contact last" rule (supersedes R3's earliest-connector rule) and the
 * sticky manual-owner marker.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { NON_TOUCH_ACTIVITY_TYPES, resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import {
  OWNER_BACKFILL_SOURCE,
  OWNER_IGNORED_ACTIVITY_TYPES,
  hasManualOwner,
  pickOwnerByLastWorked,
  type OwnerConnection,
  type OwnerTouch,
} from "@/lib/identity/ownerRule";

const d = (iso: string) => new Date(iso);

function conn(bdId: string, connectedOn: string | null, lastMessageAt: Date | null = null): OwnerConnection {
  return { bdId, connectedOn, lastMessageAt };
}

test("last touch wins over an earlier connection", () => {
  const owner = pickOwnerByLastWorked(
    [conn("bd-early", "1 Jan 2020", d("2024-01-01T00:00:00Z")), conn("bd-late", "1 Jan 2023", d("2024-06-01T00:00:00Z"))],
    [],
  );
  assert.equal(owner, "bd-late");
});

test("an activity touch beats an older last message from another BD", () => {
  const touches: OwnerTouch[] = [{ bdId: "bd-b", at: d("2025-03-01T00:00:00Z") }];
  const owner = pickOwnerByLastWorked(
    [conn("bd-a", "1 Jan 2020", d("2024-01-01T00:00:00Z")), conn("bd-b", "1 Jan 2023", null)],
    touches,
  );
  assert.equal(owner, "bd-b");
});

test("a BD's own touch is the later of its last message and its activities", () => {
  const owner = pickOwnerByLastWorked(
    [conn("bd-a", "1 Jan 2020", d("2025-05-01T00:00:00Z")), conn("bd-b", "1 Jan 2021", null)],
    [{ bdId: "bd-a", at: d("2020-01-01T00:00:00Z") }, { bdId: "bd-b", at: d("2025-04-01T00:00:00Z") }],
  );
  assert.equal(owner, "bd-a");
});

test("an exact tie on last touch falls back to the earliest connection", () => {
  const same = d("2024-01-01T00:00:00Z");
  const owner = pickOwnerByLastWorked([conn("bd-new", "1 Jan 2023", same), conn("bd-old", "1 Jan 2020", same)], []);
  assert.equal(owner, "bd-old");
});

test("a tied BD with an unparseable connectedOn sorts after one with a date", () => {
  const same = d("2024-01-01T00:00:00Z");
  const owner = pickOwnerByLastWorked([conn("bd-junk", "garbage", same), conn("bd-dated", "1 Jan 2023", same)], []);
  assert.equal(owner, "bd-dated");
});

test("a touch from a BD without a connection still counts", () => {
  const owner = pickOwnerByLastWorked([conn("bd-a", "1 Jan 2020", d("2024-01-01T00:00:00Z"))], [{ bdId: "bd-x", at: d("2025-01-01T00:00:00Z") }]);
  assert.equal(owner, "bd-x");
});

test("no touch anywhere: earliest parseable connectedOn wins (R3 still holds)", () => {
  const owner = pickOwnerByLastWorked([conn("bd-late", "10 Mar 2022"), conn("bd-early", "1 Jan 2020"), conn("bd-junk", "???")], []);
  assert.equal(owner, "bd-early");
});

test("no touch and no parseable connectedOn: undecided (null)", () => {
  assert.equal(pickOwnerByLastWorked([conn("bd-junk", "???"), conn("bd-none", null)], []), null);
  assert.equal(pickOwnerByLastWorked([], []), null);
});

test("pickOwnerByLastWorked does not mutate its inputs and is repeatable", () => {
  const connections = [conn("bd-a", "1 Jan 2020", d("2024-01-01T00:00:00Z")), conn("bd-b", "1 Jan 2021", d("2024-02-01T00:00:00Z"))];
  const touches = [{ bdId: "bd-a", at: d("2024-03-01T00:00:00Z") }];
  const snapshot = JSON.stringify({ connections, touches });
  const first = pickOwnerByLastWorked(connections, touches);
  const second = pickOwnerByLastWorked(connections, touches);
  assert.equal(first, second);
  assert.equal(first, "bd-a");
  assert.equal(JSON.stringify({ connections, touches }), snapshot);
});

test("hasManualOwner: only an ownerBdId row with source 'edit' is the marker", () => {
  assert.equal(hasManualOwner([{ property: "ownerBdId", source: "edit" }]), true);
  assert.equal(hasManualOwner([{ property: "owner_bd_id", source: "edit" }]), true, "legacy spelling written by updateLeadOwner");
  assert.equal(hasManualOwner([{ property: "ownerBdId", source: "merge" }]), false);
  assert.equal(hasManualOwner([{ property: "ownerBdId", source: "import" }]), false);
  assert.equal(hasManualOwner([{ property: "email", source: "edit" }]), false);
  assert.equal(hasManualOwner([]), false);
});

test("the backfill's own source never reads as a manual edit", () => {
  assert.equal(hasManualOwner([{ property: "ownerBdId", source: OWNER_BACKFILL_SOURCE }]), false);
});

// --- call_attempt (call-logging-one-tap) ------------------------------------
// The exclusion itself is a SQL `notInArray` in ownerRuleDb.ts built from this
// list, so these tests pin the list and its disagreement with the last-activity bar.

test("dialling a number is not working the relationship: call_attempt is on the ownership ignore list", () => {
  assert.deepEqual([...OWNER_IGNORED_ACTIVITY_TYPES], ["call_attempt"]);
});

test("the ownership bar is stricter than the last-activity bar: a dialled attempt shows in one and not the other", () => {
  assert.equal((NON_TOUCH_ACTIVITY_TYPES as readonly string[]).includes("call_attempt"), false);
  assert.equal(
    resolveEffectiveActivityAt({ id: "a", type: "call_attempt", createdAt: new Date("2026-10-05"), metadata: {} })?.toISOString(),
    "2026-10-05T00:00:00.000Z",
  );
  assert.notDeepEqual([...OWNER_IGNORED_ACTIVITY_TYPES], [...NON_TOUCH_ACTIVITY_TYPES]);
});
