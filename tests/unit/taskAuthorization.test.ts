/**
 * Unit tests for src/lib/tasks/authorization.ts (task-edit change) — the one
 * shared authorization rule for editing/completing/reopening a task: the
 * task's assignee, its creator, anyone who can edit the subject
 * contact/company, or an admin. `checkContactEditable` is injected so this
 * stays DB-free (production wires the real `assertContactEditableById`,
 * src/lib/contacts/queries.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTaskAuthorized, type TaskAuthSubject } from "@/lib/tasks/authorization";
import { TaskNotFoundError } from "@/lib/tasks/errors";

const BASE: TaskAuthSubject = {
  assignedToBdId: "assignee-1",
  actorBdId: "creator-1",
  personId: null,
  companyKey: null,
};

function neverCalled() {
  return async () => {
    throw new Error("checkContactEditable must not be called");
  };
}

test("the assignee is always authorized, without checking the subject", async () => {
  await assertTaskAuthorized(BASE, { id: "assignee-1", role: "bd" }, neverCalled());
});

test("the creator is always authorized, without checking the subject", async () => {
  await assertTaskAuthorized(BASE, { id: "creator-1", role: "bd" }, neverCalled());
});

test("an admin is always authorized, without checking the subject", async () => {
  await assertTaskAuthorized(BASE, { id: "someone-else", role: "admin" }, neverCalled());
});

test("a person-scoped task defers to checkContactEditable for anyone else", async () => {
  const task = { ...BASE, personId: "person-1" };
  let calledWith: string | null = null;
  await assertTaskAuthorized(task, { id: "random-bd", role: "bd" }, async (personId) => {
    calledWith = personId;
  });
  assert.equal(calledWith, "person-1");
});

test("propagates whatever checkContactEditable throws (e.g. a merged contact)", async () => {
  const task = { ...BASE, personId: "person-1" };
  class ContactMergedError extends Error {}
  await assert.rejects(
    assertTaskAuthorized(task, { id: "random-bd", role: "bd" }, async () => {
      throw new ContactMergedError();
    }),
    ContactMergedError,
  );
});

test("a company-scoped task has no editable gate for anyone else (no merge concept for companies)", async () => {
  const task = { ...BASE, companyKey: "acme" };
  await assertTaskAuthorized(task, { id: "random-bd", role: "bd" }, neverCalled());
});

test("a task with neither subject is rejected for anyone but assignee/creator/admin", async () => {
  await assert.rejects(
    assertTaskAuthorized(BASE, { id: "random-bd", role: "bd" }, neverCalled()),
    TaskNotFoundError,
  );
});
