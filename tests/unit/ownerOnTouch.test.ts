/**
 * The decision path of "the BD who contacts becomes the owner" (ownerOnTouch.ts).
 * The SQL-side exclusion of no-progress types (lusha_reveal, call_attempt, ...) is
 * exercised against a real database in tests/db/ownerFollowsLastTouch.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasManualOwner, MANUAL_OWNER_SOURCE, OWNER_BACKFILL_SOURCE, OWNER_HISTORY_PROPERTY, OWNER_TOUCH_SOURCE } from "@/lib/identity/ownerRule";
import { planOwnerTransfersOnTouch, type OwnerOnTouchInput } from "@/lib/identity/ownerOnTouch";

const at = (iso: string) => new Date(iso);

function input(over: Partial<OwnerOnTouchInput> = {}): OwnerOnTouchInput {
  return {
    persons: [{ id: "p1", ownerBdId: "bd-a" }],
    connections: [],
    touches: [],
    manualPersonIds: new Set<string>(),
    ...over,
  };
}

test("a touch by BD B on a contact owned by A moves it to B, on the last_touch basis", () => {
  const plan = planOwnerTransfersOnTouch(
    input({ touches: [{ personId: "p1", bdId: "bd-a", at: at("2026-09-01T00:00:00Z") }, { personId: "p1", bdId: "bd-b", at: at("2026-10-01T00:00:00Z") }] }),
  );
  assert.deepEqual(plan, [{ personId: "p1", fromBdId: "bd-a", toBdId: "bd-b", basis: "last_touch" }]);
});

test("a touch by the current owner is a no-op", () => {
  const plan = planOwnerTransfersOnTouch(
    input({ touches: [{ personId: "p1", bdId: "bd-b", at: at("2026-09-01T00:00:00Z") }, { personId: "p1", bdId: "bd-a", at: at("2026-10-01T00:00:00Z") }] }),
  );
  assert.deepEqual(plan, []);
});

test("a manual (edit) owner never moves, however recent the other BD's touch", () => {
  const plan = planOwnerTransfersOnTouch(
    input({
      manualPersonIds: new Set(["p1"]),
      touches: [{ personId: "p1", bdId: "bd-b", at: at("2026-10-25T00:00:00Z") }],
    }),
  );
  assert.deepEqual(plan, []);
});

test("with no touch at all the seniority fallback must NOT move the owner (that is the cron's call, not a touch's)", () => {
  const plan = planOwnerTransfersOnTouch(
    input({ connections: [{ personId: "p1", bdId: "bd-b", connectedOn: "1 Jan 2020", lastMessageAt: null }] }),
  );
  assert.deepEqual(plan, []);
});

test("the planner never mutates its input: two calls with the same input agree", () => {
  const i = input({ touches: [{ personId: "p1", bdId: "bd-b", at: at("2026-10-01T00:00:00Z") }] });
  const snapshot = JSON.stringify({ ...i, manualPersonIds: [...i.manualPersonIds] });
  const first = planOwnerTransfersOnTouch(i);
  const second = planOwnerTransfersOnTouch(i);
  assert.deepEqual(second, first);
  assert.equal(first.length, 1);
  assert.equal(JSON.stringify({ ...i, manualPersonIds: [...i.manualPersonIds] }), snapshot);
});

test("the on-touch history source is its own value and never marks an owner as manual", () => {
  assert.notEqual(OWNER_TOUCH_SOURCE, MANUAL_OWNER_SOURCE);
  assert.notEqual(OWNER_TOUCH_SOURCE, OWNER_BACKFILL_SOURCE);
  assert.equal(hasManualOwner([{ property: OWNER_HISTORY_PROPERTY, source: OWNER_TOUCH_SOURCE }]), false);
});
