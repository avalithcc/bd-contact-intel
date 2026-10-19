import assert from "node:assert/strict";
import { test } from "node:test";
import { listPathsFor } from "@/lib/contacts/revalidateLists";

test("listPathsFor: a touch refreshes the queue, scheduled and contacts lists, nothing layout-wide", () => {
  assert.deepEqual(listPathsFor(["touch"]), ["/follow-ups", "/scheduled", "/contacts"]);
});

test("listPathsFor: effects combine without duplicates, in first-seen order", () => {
  assert.deepEqual(listPathsFor(["touch", "meetings", "contactList", "tasks"]), ["/follow-ups", "/scheduled", "/contacts", "/reuniones", "/tasks"]);
});

test("listPathsFor: each narrow effect maps to its own list", () => {
  assert.deepEqual(listPathsFor(["sequences"]), ["/sequences"]);
  assert.deepEqual(listPathsFor(["scheduled"]), ["/scheduled"]);
  assert.deepEqual(listPathsFor(["contactList"]), ["/contacts"]);
});

test("listPathsFor: never mutates its input and is repeatable", () => {
  const input = ["touch", "tasks"] as const;
  const copy = [...input];
  const first = listPathsFor(input);
  assert.deepEqual(input, copy);
  assert.deepEqual(listPathsFor(input), first);
});

test("listPathsFor: never includes a layout-wide or root path", () => {
  const all = listPathsFor(["touch", "tasks", "meetings", "sequences", "scheduled", "contactList"]);
  assert.ok(!all.includes("/"));
});
