/**
 * Unit tests for src/lib/tasks/assignee.ts (task-essentials backlog item 2:
 * "let the creator pick any active BD, defaulting to themselves"). Pure —
 * reuses normalizeOwnerSelectValue's uuid validation (src/lib/contacts/
 * bulkOwner.ts), so a task assignee `<select>` follows the exact same
 * "blank or uuid, else reject" contract every owner `<select>` in this app
 * already follows. Unlike a Contact/Company owner, a task is never
 * "unassigned" — blank means "assign it to me", not null.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTaskAssignee, buildTaskAssigneeOptions } from "@/lib/tasks/assignee";

const CREATOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_BD_ID = "22222222-2222-4222-8222-222222222222";

test("resolveTaskAssignee defaults a blank selection to the creator", () => {
  assert.equal(resolveTaskAssignee("", CREATOR_ID), CREATOR_ID);
});

test("resolveTaskAssignee passes through a well-formed uuid unchanged", () => {
  assert.equal(resolveTaskAssignee(OTHER_BD_ID, CREATOR_ID), OTHER_BD_ID);
});

test("resolveTaskAssignee rejects a non-uuid value instead of silently defaulting", () => {
  assert.equal(resolveTaskAssignee("not-a-uuid", CREATOR_ID), undefined);
});

test("resolveTaskAssignee never mutates its inputs (pure)", () => {
  const before = { CREATOR_ID, OTHER_BD_ID };
  resolveTaskAssignee(OTHER_BD_ID, CREATOR_ID);
  assert.deepEqual({ CREATOR_ID, OTHER_BD_ID }, before);
});

/**
 * buildTaskAssigneeOptions — the "Asignado a" <select> option list (mockup
 * contact-record.html #task: "Cristian Civita (yo)" / "Ana Pereyra
 * (responsable)"). One entry per BD — no separate blank "Yo" option.
 */
const ME = { id: CREATOR_ID, name: "Cristian Civita" };
const OWNER = { id: OTHER_BD_ID, name: "Ana Pereyra" };
const THIRD_BD_ID = "33333333-3333-4333-8333-333333333333";
const THIRD = { id: THIRD_BD_ID, name: "Macarena Dávila" };

test("buildTaskAssigneeOptions puts the current BD first, labeled '(yo)'", () => {
  const options = buildTaskAssigneeOptions([OWNER, ME, THIRD], ME.id);
  assert.equal(options[0].id, ME.id);
  assert.equal(options[0].label, "Cristian Civita (yo)");
});

test("buildTaskAssigneeOptions labels the subject's owner '(responsable)' when known and not me", () => {
  const options = buildTaskAssigneeOptions([ME, OWNER, THIRD], ME.id, OWNER.id);
  const ownerOption = options.find((o) => o.id === OWNER.id);
  assert.equal(ownerOption?.label, "Ana Pereyra (responsable)");
});

test("buildTaskAssigneeOptions never double-marks: when I am also the owner, only '(yo)' shows", () => {
  const options = buildTaskAssigneeOptions([ME, THIRD], ME.id, ME.id);
  const meOption = options.find((o) => o.id === ME.id);
  assert.equal(meOption?.label, "Cristian Civita (yo)");
});

test("buildTaskAssigneeOptions renders every other BD with just their name", () => {
  const options = buildTaskAssigneeOptions([ME, OWNER, THIRD], ME.id, OWNER.id);
  const thirdOption = options.find((o) => o.id === THIRD.id);
  assert.equal(thirdOption?.label, "Macarena Dávila");
});

test("buildTaskAssigneeOptions omits the '(responsable)' marker entirely when ownerBdId is unknown", () => {
  const options = buildTaskAssigneeOptions([ME, OWNER, THIRD], ME.id);
  assert.equal(
    options.every((o) => !o.label.includes("responsable")),
    true,
  );
});

test("buildTaskAssigneeOptions is pure: same input twice yields equal output, never mutates the bds array", () => {
  const bds = [OWNER, ME, THIRD];
  const before = JSON.stringify(bds);
  const result1 = buildTaskAssigneeOptions(bds, ME.id, OWNER.id);
  const result2 = buildTaskAssigneeOptions(bds, ME.id, OWNER.id);
  assert.deepEqual(result1, result2);
  assert.equal(JSON.stringify(bds), before);
});
