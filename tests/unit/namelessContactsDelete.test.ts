import assert from "node:assert/strict";
import { test } from "node:test";
import { REFERENCING_TABLES, STATE_FLAGS, TOUCH_FLAGS, type TouchFlag } from "@/lib/contactosComerciales/revert";
import { NAMELESS_SCAN_CAP, planNamelessDeletion } from "@/lib/namelessContacts/plan";

const ids = ["a", "b", "c", "d"].map((c) => `00000000-0000-4000-8000-00000000000${c.charCodeAt(0) - 96}`);
const [A, B, C, D] = ids as [string, string, string, string];
const facts = (entries: [string, TouchFlag[]][]) => new Map(entries);

test("only persons with no trace at all are deletable; everything else is kept with its reasons", () => {
  const plan = planNamelessDeletion([A, B, C], facts([[A, []], [B, ["activity"]], [C, ["merge_winner", "task"]]]), 3);
  assert.deepEqual(plan.deletable, [A]);
  assert.deepEqual(plan.kept, [{ id: B, reasons: ["activity"] }, { id: C, reasons: ["merge_winner", "task"] }]);
  assert.deepEqual(plan.keptReasons, { activity: 1, merge_winner: 1, task: 1 });
});

test("every touch flag keeps the person", () => {
  for (const flag of TOUCH_FLAGS) assert.deepEqual(planNamelessDeletion([A], facts([[A, [flag]]]), 1).deletable, [], flag);
});

test("the guard covers every table the owner listed, plus the id map, and the state flags", () => {
  const tables = REFERENCING_TABLES.map(([, table]) => table);
  for (const t of ["activity", "task", "email_message", "email_message_person", "signal", "linkedin_scrape_job", "follow_up_queue_item", "person_bd_connection", "duplicate_candidate", "merge_event"]) {
    assert.ok(tables.includes(t as (typeof tables)[number]), t);
  }
  for (const f of ["merged_away", "merge_winner", "edited"]) assert.ok((STATE_FLAGS as readonly string[]).includes(f), f);
});

test("a selection that is not the expected size refuses instead of widening or shrinking", () => {
  assert.throws(() => planNamelessDeletion([A, B], facts([[A, []], [B, []]]), 7), /expected 7/);
  assert.throws(() => planNamelessDeletion([A], facts([[A, []]]), 0), /expected 0/);
});

test("a selected id with no fact row is refused, never deleted", () => {
  assert.throws(() => planNamelessDeletion([A, D], facts([[A, []]]), 2), /no touch facts/);
});

test("refuses a scan above the cap", () => {
  const many = Array.from({ length: NAMELESS_SCAN_CAP + 1 }, (_, i) => `id${i}`);
  assert.throws(() => planNamelessDeletion(many, new Map(), many.length), /cap/);
});

test("planner never mutates its inputs and is repeatable", () => {
  const selected = [A, B];
  const f = facts([[A, []], [B, ["task"]]]);
  const snapshot = JSON.stringify([selected, [...f]]);
  assert.deepEqual(planNamelessDeletion(selected, f, 2), planNamelessDeletion(selected, f, 2));
  assert.equal(JSON.stringify([selected, [...f]]), snapshot);
});
