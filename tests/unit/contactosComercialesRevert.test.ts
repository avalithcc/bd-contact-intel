import assert from "node:assert/strict";
import { test } from "node:test";
import { buildComercialPlan, type ExistingPerson } from "@/lib/contactosComerciales/plan";
import { planRevert, TOUCH_FLAGS, type TouchFlag } from "@/lib/contactosComerciales/revert";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const GONE = "00000000-0000-4000-8000-0000000000ff";
const facts = (entries: [string, TouchFlag[]][]) => new Map(entries);

test("only contacts nobody has worked on are deletable", () => {
  const plan = planRevert({ createdIds: [A, B, C], facts: facts([[A, []], [B, ["activity"]], [C, ["merge_winner", "task"]]]), fills: [], currentPhones: new Map() });
  assert.deepEqual(plan.deletable, [A]);
  assert.deepEqual(plan.kept, [{ id: B, reasons: ["activity"] }, { id: C, reasons: ["merge_winner", "task"] }]);
  assert.equal(plan.missing, 0);
});

test("every touch flag keeps the contact", () => {
  for (const flag of TOUCH_FLAGS) {
    const plan = planRevert({ createdIds: [A], facts: facts([[A, [flag]]]), fills: [], currentPhones: new Map() });
    assert.deepEqual(plan.deletable, [], flag);
  }
});

test("an id with no live row is reported as missing, never deleted", () => {
  const plan = planRevert({ createdIds: [A, GONE], facts: facts([[A, []]]), fills: [], currentPhones: new Map() });
  assert.deepEqual(plan.deletable, [A]);
  assert.equal(plan.missing, 1);
});

test("phone restores clear only columns that still hold the filled value", () => {
  // Real producer: the planner's own fills and history rows.
  const existing: ExistingPerson[] = [{ id: B, emailNormalized: "b@x.example", phone: null, mobilePhone: null }];
  const made = buildComercialPlan([{ firstName: "B", lastName: null, company: null, lastContact: null, email: "b@x.example", phones: ["+54 9 11 5555 0100", "+54 9 11 5555 0101"], nameInferred: false }], { ownerBdId: A, existing, companyAliasByKey: new Map() });
  const fills = made.historyRows.map((h) => ({ personId: h.personId, property: h.property, filledValue: h.newValue! }));
  const same = planRevert({ createdIds: [], facts: new Map(), fills, currentPhones: new Map([[B, { phone: "+54 9 11 5555 0100", mobilePhone: "+54 9 11 5555 0101" }]]) });
  assert.deepEqual(same.clears, [{ personId: B, phone: true, mobilePhone: true }]);
  const edited = planRevert({ createdIds: [], facts: new Map(), fills, currentPhones: new Map([[B, { phone: "999999", mobilePhone: "+54 9 11 5555 0101" }]]) });
  assert.deepEqual(edited.clears, [{ personId: B, phone: false, mobilePhone: true }]);
  assert.equal(edited.changedSince, 1);
});

test("planRevert never mutates its inputs and is repeatable", () => {
  const input = { createdIds: [A, B], facts: facts([[A, []], [B, ["task"]]]), fills: [{ personId: C, property: "phone", filledValue: "123456" }], currentPhones: new Map([[C, { phone: "123456", mobilePhone: null }]]) };
  const snapshot = JSON.stringify([input.createdIds, [...input.facts], input.fills, [...input.currentPhones]]);
  assert.deepEqual(planRevert(input), planRevert(input));
  assert.equal(JSON.stringify([input.createdIds, [...input.facts], input.fills, [...input.currentPhones]]), snapshot);
});
