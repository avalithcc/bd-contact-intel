/**
 * Unit tests for src/lib/tasks/taskActivityBody.ts (task-edit change) — the
 * pure formatter shared by the Contact timeline (timelineEntryBody.ts) and
 * the Company timeline (companies/timelineView.ts) for the three task
 * activity types (`task_updated`, `task_completed`, `task_reopened`), and
 * buildTaskActivityRow, the pure builder for the `activity` row itself.
 *
 * Owner decision (2026-09-29): any BD may edit/complete/reopen any task, but
 * the system must leave a record of WHO did it — every row sets `actorBdId`
 * (buildTaskActivityRow tests below), and the body text names the actor
 * directly (e.g. "Macarena editó la tarea «X»: …"), not just what changed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  taskActivityBody,
  buildTaskActivityRow,
  ALL_TASK_ACTIVITY_TYPES,
  buildTaskCreatedMetadata,
  type TaskActivityBodyLabels,
} from "@/lib/tasks/taskActivityBody";
import { TASK_ACTIVITY_TYPES } from "@/lib/activity/timelinePills";
import { NON_TOUCH_ACTIVITY_TYPES } from "@/lib/contacts/effectiveActivityTime";
import { MEETING_ACTIVITY_TYPES } from "@/lib/meetings/status";

const LABELS: TaskActivityBodyLabels = {
  fieldTitle: "Título",
  fieldDue: "Vencimiento",
  fieldAssignee: "Asignada a",
  fieldDescription: "Descripción",
  createdPrefix: "creó la tarea",
  createdDuePrefix: "vence",
  createdAssigneePrefix: "asignada a",
  updatedPrefix: "editó la tarea",
  completedPrefix: "completó la tarea",
  reopenedPrefix: "reabrió la tarea",
  unknownActor: "Un usuario",
};

test("task_completed names the actor: '<actor> completó la tarea «X»'", () => {
  const body = taskActivityBody("task_completed", { taskTitle: "Enviar propuesta" }, "Macarena", LABELS);
  assert.equal(body, "Macarena completó la tarea «Enviar propuesta»");
});

test("task_reopened names the actor: '<actor> reabrió la tarea «X»'", () => {
  const body = taskActivityBody("task_reopened", { taskTitle: "Enviar propuesta" }, "Macarena", LABELS);
  assert.equal(body, "Macarena reabrió la tarea «Enviar propuesta»");
});

test("task_updated names the actor and renders every changed field as 'label from → to'", () => {
  const body = taskActivityBody(
    "task_updated",
    {
      taskTitle: "Enviar propuesta",
      changes: [
        { field: "dueAt", from: "12 oct", to: "20 oct" },
        { field: "assignedToBdId", from: "Cristian", to: "Macarena" },
      ],
    },
    "Macarena",
    LABELS,
  );
  assert.equal(
    body,
    "Macarena editó la tarea «Enviar propuesta»: Vencimiento 12 oct → 20 oct · Asignada a Cristian → Macarena",
  );
});

test("task_updated falls back to an em dash for a null from/to value", () => {
  const body = taskActivityBody(
    "task_updated",
    { taskTitle: "X", changes: [{ field: "dueAt", from: null, to: "20 oct" }] },
    "Macarena",
    LABELS,
  );
  assert.equal(body, "Macarena editó la tarea «X»: Vencimiento — → 20 oct");
});

test("a null actorName falls back to the unknown-actor label, never a blank/undefined name", () => {
  const body = taskActivityBody("task_completed", { taskTitle: "X" }, null, LABELS);
  assert.equal(body, "Un usuario completó la tarea «X»");
});

test("an unknown type returns an empty string", () => {
  assert.equal(taskActivityBody("note", { taskTitle: "X" }, "Macarena", LABELS), "");
});

test("buildTaskActivityRow always sets actorBdId from its required parameter", () => {
  const row = buildTaskActivityRow(
    "task_completed",
    { personId: "person-1", companyKey: null },
    "bd-macarena",
    { taskId: "task-1", taskTitle: "Enviar propuesta" },
  );
  assert.equal(row.actorBdId, "bd-macarena");
  assert.equal(row.type, "task_completed");
  assert.equal(row.personId, "person-1");
  assert.equal(row.companyKey, null);
  assert.deepEqual(row.metadata, { taskId: "task-1", taskTitle: "Enviar propuesta" });
});

test("buildTaskActivityRow carries the subject's companyKey for a company-scoped task", () => {
  const row = buildTaskActivityRow("task_reopened", { personId: null, companyKey: "acme" }, "bd-1", {
    taskId: "task-2",
    taskTitle: "Llamar",
  });
  assert.equal(row.personId, null);
  assert.equal(row.companyKey, "acme");
  assert.equal(row.actorBdId, "bd-1");
});

test("task_created names the actor: '<actor> creó la tarea «X»'", () => {
  const body = taskActivityBody("task_created", { taskTitle: "Enviar propuesta" }, "Macarena", LABELS);
  assert.equal(body, "Macarena creó la tarea «Enviar propuesta»");
});

test("buildTaskActivityRow builds a task_created row that names the creator", () => {
  const row = buildTaskActivityRow("task_created", { personId: "person-1", companyKey: null }, "bd-macarena", {
    taskId: "task-1",
    taskTitle: "Enviar propuesta",
  });
  assert.equal(row.type, "task_created");
  assert.equal(row.actorBdId, "bd-macarena");
  assert.deepEqual(row.metadata, { taskId: "task-1", taskTitle: "Enviar propuesta" });
});

test("every task activity type is registered in each list that must know about it", () => {
  assert.deepEqual([...ALL_TASK_ACTIVITY_TYPES].sort(), ["task_completed", "task_created", "task_reopened", "task_updated"]);
  assert.deepEqual([...TASK_ACTIVITY_TYPES].sort(), [...ALL_TASK_ACTIVITY_TYPES].sort());
  // Task writes and the meeting lifecycle records (meeting-outcomes) are the activity that is not a touch of the Contact.
  assert.deepEqual([...NON_TOUCH_ACTIVITY_TYPES].sort(), [...ALL_TASK_ACTIVITY_TYPES, ...MEETING_ACTIVITY_TYPES].sort());
});

test("task_created shows the due date and assignee after the title", () => {
  const body = taskActivityBody(
    "task_created",
    { taskTitle: "Enviar propuesta", dueLabel: "12 oct", assigneeName: "Cristian" },
    "Macarena",
    LABELS,
  );
  assert.equal(body, "Macarena creó la tarea «Enviar propuesta» · vence 12 oct · asignada a Cristian");
});

test("task_created omits an unset due date or assignee instead of printing a blank", () => {
  assert.equal(
    taskActivityBody("task_created", { taskTitle: "X", dueLabel: null, assigneeName: "Cristian" }, "Macarena", LABELS),
    "Macarena creó la tarea «X» · asignada a Cristian",
  );
  assert.equal(taskActivityBody("task_created", { taskTitle: "X" }, "Macarena", LABELS), "Macarena creó la tarea «X»");
});

test("buildTaskCreatedMetadata keeps the ids and formats the due date once", () => {
  const meta = buildTaskCreatedMetadata({ id: "t1", title: "Llamar", dueAt: null }, "Cristian");
  assert.deepEqual(meta, { taskId: "t1", taskTitle: "Llamar", dueLabel: null, assigneeName: "Cristian" });
  const due = buildTaskCreatedMetadata({ id: "t1", title: "Llamar", dueAt: new Date("2026-10-20T15:00:00.000Z") }, null);
  assert.equal(typeof due.dueLabel, "string");
  assert.equal(due.assigneeName, null);
});

test("task_created is status-neutral and not a touch", async () => {
  const { STATUS_NEUTRAL_ACTIVITY_TYPES } = await import("@/lib/status/deriveStatus");
  assert.ok((STATUS_NEUTRAL_ACTIVITY_TYPES as readonly string[]).includes("task_created"));
  assert.ok((NON_TOUCH_ACTIVITY_TYPES as readonly string[]).includes("task_created"));
});
