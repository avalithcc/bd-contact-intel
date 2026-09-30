/**
 * Unit tests for src/lib/tasks/taskEditDiff.ts (task-edit change) — the pure
 * diff builder behind the "Editar tarea" dialog's `task_updated` activity
 * row.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { diffTaskEdit, type TaskEditSnapshot } from "@/lib/tasks/taskEditDiff";

const BASE: TaskEditSnapshot = {
  title: "Llamar al cliente",
  dueAt: new Date("2026-10-12T00:00:00.000Z"),
  assignedToBdId: "bd-1",
  description: "Coordinar la próxima reunión",
};

const formatDueAt = (dueAt: Date | null): string | null =>
  dueAt ? dueAt.toISOString().slice(0, 10) : null;

const NAMES: Record<string, string> = { "bd-1": "Cristian", "bd-2": "Macarena" };
const nameOf = (id: string | null): string | null => (id ? (NAMES[id] ?? null) : null);

test("diffTaskEdit returns no changes when every field is identical", () => {
  const changes = diffTaskEdit(BASE, { ...BASE }, formatDueAt, nameOf);
  assert.deepEqual(changes, []);
});

test("diffTaskEdit detects a title change", () => {
  const after = { ...BASE, title: "Llamar al cliente (urgente)" };
  const changes = diffTaskEdit(BASE, after, formatDueAt, nameOf);
  assert.deepEqual(changes, [{ field: "title", from: BASE.title, to: after.title }]);
});

test("diffTaskEdit formats a due-date change through the injected formatter", () => {
  const after = { ...BASE, dueAt: new Date("2026-10-20T00:00:00.000Z") };
  const changes = diffTaskEdit(BASE, after, formatDueAt, nameOf);
  assert.deepEqual(changes, [{ field: "dueAt", from: "2026-10-12", to: "2026-10-20" }]);
});

test("diffTaskEdit treats a cleared due date as a real change", () => {
  const after = { ...BASE, dueAt: null };
  const changes = diffTaskEdit(BASE, after, formatDueAt, nameOf);
  assert.deepEqual(changes, [{ field: "dueAt", from: "2026-10-12", to: null }]);
});

test("diffTaskEdit resolves the assignee change to display names, not raw ids", () => {
  const after = { ...BASE, assignedToBdId: "bd-2" };
  const changes = diffTaskEdit(BASE, after, formatDueAt, nameOf);
  assert.deepEqual(changes, [{ field: "assignedToBdId", from: "Cristian", to: "Macarena" }]);
});

test("diffTaskEdit truncates a long description preview", () => {
  const longText = "x".repeat(80);
  const after = { ...BASE, description: longText };
  const changes = diffTaskEdit(BASE, after, formatDueAt, nameOf);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, "description");
  assert.equal(changes[0].to, `${"x".repeat(60)}…`);
});

test("diffTaskEdit treats null and empty-string description as equal (no spurious change)", () => {
  const before = { ...BASE, description: null };
  const after = { ...BASE, description: "" };
  assert.deepEqual(diffTaskEdit(before, after, formatDueAt, nameOf), []);
});

test("diffTaskEdit reports multiple simultaneous field changes", () => {
  const after: TaskEditSnapshot = {
    title: "Nuevo título",
    dueAt: null,
    assignedToBdId: "bd-2",
    description: BASE.description,
  };
  const changes = diffTaskEdit(BASE, after, formatDueAt, nameOf);
  const fields = changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ["assignedToBdId", "dueAt", "title"]);
});
