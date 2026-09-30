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
  type TaskActivityBodyLabels,
} from "@/lib/tasks/taskActivityBody";

const LABELS: TaskActivityBodyLabels = {
  fieldTitle: "Título",
  fieldDue: "Vencimiento",
  fieldAssignee: "Asignada a",
  fieldDescription: "Descripción",
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
