import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseDefaultSurvivor } from "@/lib/identity/duplicateReviewView";
import { planMergeOne, type MergeOneInput, type MergeOneSide } from "@/lib/identity/mergeOneDuplicate";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const side = (id: string, over: Partial<MergeOneSide> = {}): MergeOneSide => ({
  id,
  profileKey: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  mergedIntoId: null,
  connections: [],
  ...over,
});
const input = (a: MergeOneSide, b: MergeOneSide, over: Partial<MergeOneInput> = {}): MergeOneInput => ({
  candidate: { id: "c1", status: "open", reason: "name_company", personAId: a.id, personBId: b.id },
  a,
  b,
  survivorArg: null,
  ...over,
});

test("a profile key decides the survivor, and the plan names why", () => {
  const plan = planMergeOne(input(side(A), side(B, { profileKey: "linkedin.com/in/x" })));
  assert.deepEqual([plan.kind, plan.kind === "merge" && plan.survivorId, plan.kind === "merge" && plan.why], ["merge", B, "profile_key"]);
});

test("the picked side always equals chooseDefaultSurvivor, across every discriminator", () => {
  const early = [{ connectedOn: "01 Jan 2020", messageCount: 1 }];
  const late = [{ connectedOn: "01 Jan 2024", messageCount: 1 }];
  const cases: [MergeOneSide, MergeOneSide, string][] = [
    [side(A, { profileKey: "k" }), side(B), "profile_key"],
    [side(A, { connections: late }), side(B, { connections: early }), "earliest_connection"],
    [side(A, { createdAt: new Date("2026-03-01") }), side(B, { createdAt: new Date("2026-02-01") }), "earlier_created"],
    [side(A), side(B), "tie_defaults_to_a"],
  ];
  for (const [a, b, why] of cases) {
    const plan = planMergeOne(input(a, b));
    assert.equal(plan.kind, "merge");
    if (plan.kind !== "merge") continue;
    const expected = chooseDefaultSurvivor(a, a.connections, b, b.connections) === "a" ? A : B;
    assert.equal(plan.survivorId, expected, why);
    assert.equal(plan.why, why);
  }
});

test("--survivor that agrees with the default is accepted; one that disagrees is refused", () => {
  const a = side(A);
  const b = side(B, { profileKey: "k" });
  assert.equal(planMergeOne(input(a, b, { survivorArg: B })).kind, "merge");
  const refused = planMergeOne(input(a, b, { survivorArg: A }));
  assert.equal(refused.kind, "refuse");
  assert.match(refused.kind === "refuse" ? refused.reason : "", /disagrees/);
});

test("--survivor outside the pair is refused", () => {
  const plan = planMergeOne(input(side(A), side(B), { survivorArg: "00000000-0000-4000-8000-0000000000ff" }));
  assert.equal(plan.kind, "refuse");
});

test("refuses a candidate that is not open, or a person already merged away", () => {
  assert.equal(planMergeOne(input(side(A), side(B), { candidate: { id: "c1", status: "merged", reason: "name_company", personAId: A, personBId: B } })).kind, "refuse");
  assert.equal(planMergeOne(input(side(A, { mergedIntoId: B }), side(B))).kind, "refuse");
});

test("refuses when the default survivor would lose synced messages (the UI default ignores them)", () => {
  const msgLoss = planMergeOne(input(side(A, { createdAt: new Date("2025-01-01") }), side(B, { connections: [{ connectedOn: null, messageCount: 3 }] })));
  assert.equal(msgLoss.kind, "refuse");
  assert.match(msgLoss.kind === "refuse" ? msgLoss.reason : "", /messages/);
});

test("planner never mutates its inputs and is repeatable", () => {
  const i = input(side(A, { connections: [{ connectedOn: "01 Jan 2020", messageCount: 0 }] }), side(B, { profileKey: "k" }));
  const snapshot = JSON.stringify(i);
  assert.deepEqual(planMergeOne(i), planMergeOne(i));
  assert.equal(JSON.stringify(i), snapshot);
});
