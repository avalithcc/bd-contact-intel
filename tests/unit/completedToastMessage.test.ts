import { test } from "node:test";
import assert from "node:assert/strict";
import { completedToastMessage } from "../../src/lib/tasks/completedToastMessage";

test("names the task after the label", () => {
  assert.equal(completedToastMessage("Tarea completada", "Llamar a Ana"), "Tarea completada: Llamar a Ana");
});

test("truncates a long title with an ellipsis", () => {
  const msg = completedToastMessage("Tarea completada", "x".repeat(100));
  assert.equal(msg, `Tarea completada: ${"x".repeat(39)}…`);
});

test("keeps a title exactly at the limit and collapses whitespace", () => {
  assert.equal(completedToastMessage("L", "y".repeat(40)), `L: ${"y".repeat(40)}`);
  assert.equal(completedToastMessage("L", "  a \n b  "), "L: a b");
});

test("falls back to the label alone for a blank title", () => {
  assert.equal(completedToastMessage("Tarea completada", "   "), "Tarea completada");
});
