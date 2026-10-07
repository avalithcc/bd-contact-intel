import assert from "node:assert/strict";
import { test } from "node:test";
import { OWNER_ASSIGN_CAP, planWonOwnerAssignments, WON_OWNER_HISTORY_SOURCE, type WonCompanyRow } from "@/lib/wonCompanyOwners/plan";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const row = (companyKey: string, relationshipStage: string | null, ownerBdId: string | null): WonCompanyRow => ({ companyKey, relationshipStage, ownerBdId });

test("assigns only won companies that have no owner", () => {
  const plan = planWonOwnerAssignments([row("a", "won", null), row("b", "won", OTHER), row("c", "prospect", null), row("d", null, null), row("e", "won", null)], OWNER);
  assert.deepEqual(plan.assignments.map((a) => a.companyKey), ["a", "e"]);
  assert.deepEqual(plan.report, { wonTotal: 3, alreadyOwned: 1, toAssign: 2 });
});

test("never reassigns, even to the same owner", () => {
  const plan = planWonOwnerAssignments([row("a", "won", OWNER), row("b", "won", OTHER)], OWNER);
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.report.alreadyOwned, 2);
});

test("one history row per assignment: property ownerBdId, null old value, never source edit", () => {
  const plan = planWonOwnerAssignments([row("a", "won", null)], OWNER);
  assert.deepEqual(plan.historyRows, [{ companyKey: "a", property: "ownerBdId", oldValue: null, newValue: OWNER, source: WON_OWNER_HISTORY_SOURCE }]);
  assert.notEqual(WON_OWNER_HISTORY_SOURCE, "edit");
});

test("refuses a bulk above the cap and a non-uuid owner", () => {
  const many = Array.from({ length: OWNER_ASSIGN_CAP + 1 }, (_, i) => row(`k${i}`, "won", null));
  assert.throws(() => planWonOwnerAssignments(many, OWNER), /cap/);
  assert.throws(() => planWonOwnerAssignments([row("a", "won", null)], "nope"), /uuid/);
});

test("planner never mutates its inputs and is repeatable", () => {
  const rows = [row("a", "won", null), row("b", "won", OTHER)];
  const snapshot = JSON.stringify(rows);
  assert.deepEqual(planWonOwnerAssignments(rows, OWNER), planWonOwnerAssignments(rows, OWNER));
  assert.equal(JSON.stringify(rows), snapshot);
});
