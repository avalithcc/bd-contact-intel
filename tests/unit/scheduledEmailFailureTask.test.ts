import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFailureTask, failureTaskTitle } from "@/lib/scheduledEmail/failureTask";

const failed = { id: "s1", bdId: "bd1", personId: "p1", personName: "Ana Pérez", subject: "Hola", error: "outcome_unknown" };
const NOW = new Date("2026-10-17T12:00:00Z");

test("the title names the contact in Spanish and survives a nameless contact", () => {
  assert.equal(failureTaskTitle("Ana Pérez"), "Revisar envío programado fallido a Ana Pérez");
  assert.equal(failureTaskTitle("  "), "Revisar envío programado fallido");
});

test("the task is owned by and attributed to the scheduling BD, on the contact, due now", () => {
  const t = buildFailureTask(failed, NOW);
  assert.equal(t.assignedToBdId, "bd1");
  assert.equal(t.actorBdId, "bd1");
  assert.equal(t.personId, "p1");
  assert.equal(t.dueAt?.toISOString(), NOW.toISOString());
  assert.match(t.description!, /Hola/);
});

test("the description depends on whether the mail may have gone out", () => {
  assert.match(buildFailureTask(failed, NOW).description!, /Enviados/);
  assert.doesNotMatch(buildFailureTask({ ...failed, error: "gmail_not_connected" }, NOW).description!, /Enviados/);
  assert.match(buildFailureTask({ ...failed, error: "gmail_not_connected" }, NOW).description!, /Gmail/);
});

test("the planner never mutates its input and is repeatable", () => {
  const input = Object.freeze({ ...failed });
  const when = new Date(NOW);
  assert.deepEqual(buildFailureTask(input, when), buildFailureTask(input, when));
  assert.equal(when.getTime(), NOW.getTime());
  assert.notEqual(buildFailureTask(input, when).dueAt, when); // a copy, not the caller's Date
});
