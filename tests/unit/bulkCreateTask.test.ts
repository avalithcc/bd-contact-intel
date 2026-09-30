/**
 * Unit tests for src/lib/tasks/bulkCreate.ts (task-essentials backlog item:
 * "one set-based insert instead of a per-contact loop" in bulkCreateTaskAction,
 * src/app/(app)/contacts/bulkActions.ts). Pure — no `db` import.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_BULK_TASK_ROWS,
  assertBulkTaskRowCountWithinCap,
  buildBulkTaskRows,
  type BulkTaskSharedFields,
} from "@/lib/tasks/bulkCreate";

const PERSON_1 = "11111111-1111-4111-8111-111111111111";
const PERSON_2 = "22222222-2222-4222-8222-222222222222";
const ASSIGNEE_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const DUE_AT = new Date("2026-10-01T00:00:00.000Z");

const FIELDS: BulkTaskSharedFields = {
  title: "Llamar",
  description: "Seguimiento",
  dueAt: DUE_AT,
  assignedToBdId: ASSIGNEE_ID,
  actorBdId: ACTOR_ID,
};

test("buildBulkTaskRows builds one row per person id, all sharing the same fields", () => {
  const rows = buildBulkTaskRows([PERSON_1, PERSON_2], FIELDS);
  assert.deepEqual(rows, [
    {
      personId: PERSON_1,
      title: "Llamar",
      description: "Seguimiento",
      dueAt: DUE_AT,
      assignedToBdId: ASSIGNEE_ID,
      actorBdId: ACTOR_ID,
    },
    {
      personId: PERSON_2,
      title: "Llamar",
      description: "Seguimiento",
      dueAt: DUE_AT,
      assignedToBdId: ASSIGNEE_ID,
      actorBdId: ACTOR_ID,
    },
  ]);
});

test("buildBulkTaskRows returns an empty array for an empty selection", () => {
  assert.deepEqual(buildBulkTaskRows([], FIELDS), []);
});

test("buildBulkTaskRows never mutates its inputs (pure) — calling it twice yields equal results", () => {
  const personIds = Object.freeze([PERSON_1, PERSON_2]);
  const fields = Object.freeze({ ...FIELDS });

  const first = buildBulkTaskRows(personIds, fields);
  const second = buildBulkTaskRows(personIds, fields);

  assert.deepEqual(first, second);
  assert.deepEqual(personIds, [PERSON_1, PERSON_2]);
  assert.deepEqual(fields, FIELDS);
});

test("assertBulkTaskRowCountWithinCap accepts a count at or under MAX_BULK_TASK_ROWS", () => {
  assert.doesNotThrow(() => assertBulkTaskRowCountWithinCap(MAX_BULK_TASK_ROWS));
  assert.doesNotThrow(() => assertBulkTaskRowCountWithinCap(0));
});

test("assertBulkTaskRowCountWithinCap throws when the count exceeds MAX_BULK_TASK_ROWS", () => {
  assert.throws(() => assertBulkTaskRowCountWithinCap(MAX_BULK_TASK_ROWS + 1), RangeError);
});
