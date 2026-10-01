/**
 * Pure planner for scripts/restore-merged-phones.ts: recovers phone numbers
 * stranded on merged-away rows (merge used to drop them). Real messy values
 * from the production finding; synthetic ids and names.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatRestoreReport,
  planRestoreMergedPhones,
  type PhoneRestoreRow,
} from "@/lib/identity/restoreMergedPhones";

function row(id: string, o: Partial<PhoneRestoreRow> = {}): PhoneRestoreRow {
  return { id, name: id, ownerBdId: "bd-cristian", phone: null, mobilePhone: null, mergedIntoId: null, ...o };
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.freeze(v);
    for (const k of Object.values(v)) deepFreeze(k);
  }
  return v;
}

test("fills phone and mobile from the merged-away row when the survivor has neither", () => {
  const plan = planRestoreMergedPhones([
    row("tito", { name: "Tito Picon" }),
    row("tito-dup", { mergedIntoId: "tito", phone: "+54 (11) 4118 8080", mobilePhone: "+54 (911) 6213 0024" }),
  ]);
  assert.equal(plan.restorable.length, 1);
  assert.deepEqual(plan.restorable[0]!.fills, [
    { field: "phone", value: "+54 (11) 4118 8080", fromMergedIds: ["tito-dup"] },
    { field: "mobilePhone", value: "+54 (911) 6213 0024", fromMergedIds: ["tito-dup"] },
  ]);
});

test("fills only the field the merged row actually has", () => {
  const plan = planRestoreMergedPhones([
    row("uauy", { ownerBdId: "bd-mariel" }),
    row("uauy-dup", { mergedIntoId: "uauy", mobilePhone: "994489460" }),
  ]);
  assert.deepEqual(plan.restorable[0]!.fills, [{ field: "mobilePhone", value: "994489460", fromMergedIds: ["uauy-dup"] }]);
});

test("never touches a survivor that already has a phone or a mobile", () => {
  const plan = planRestoreMergedPhones([
    row("kemeny", { phone: "+56 2 2938 0805" }),
    row("kemeny-dup", { mergedIntoId: "kemeny", mobilePhone: "+56 9 1111 2222" }),
  ]);
  assert.equal(plan.restorable.length, 0);
  assert.equal(plan.counts.survivorsAlreadyHavePhone, 1);
});

test("two merged rows holding the same number in different formats agree", () => {
  const plan = planRestoreMergedPhones([
    row("ortega"),
    row("o1", { mergedIntoId: "ortega", phone: "+54 9 11 4590-2294" }),
    row("o2", { mergedIntoId: "ortega", phone: "+54 911 4590 2294" }),
  ]);
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(plan.restorable[0]!.fills, [{ field: "phone", value: "+54 9 11 4590-2294", fromMergedIds: ["o1", "o2"] }]);
});

test("merged rows that disagree are reported and the survivor is skipped entirely", () => {
  const plan = planRestoreMergedPhones([
    row("finelli", { name: "Nicolas Finelli" }),
    row("f1", { mergedIntoId: "finelli", phone: "+1 (954) 837-6436", mobilePhone: "+1 305 555 0101" }),
    row("f2", { mergedIntoId: "finelli", phone: "+1 (954) 111-2222" }),
  ]);
  assert.equal(plan.restorable.length, 0, "a clean mobile must not be written while the phone is in conflict");
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]!.field, "phone");
  assert.deepEqual(plan.conflicts[0]!.candidates, [
    { mergedId: "f1", value: "+1 (954) 837-6436" },
    { mergedId: "f2", value: "+1 (954) 111-2222" },
  ]);
  assert.equal(plan.counts.conflictSurvivors, 1);
});

test("a stranded value that fails validation is reported and never written", () => {
  const plan = planRestoreMergedPhones([
    row("s"),
    row("m", { mergedIntoId: "s", phone: "call me", mobilePhone: "12345" }),
  ]);
  assert.equal(plan.restorable.length, 0);
  assert.deepEqual(
    plan.invalid.map((i) => [i.mergedId, i.field, i.value]),
    [["m", "phone", "call me"], ["m", "mobilePhone", "12345"]],
  );
});

test("an invalid value does not block a valid one on the same survivor", () => {
  const plan = planRestoreMergedPhones([row("s"), row("m", { mergedIntoId: "s", phone: "n/a", mobilePhone: "+54 9 11 4590-2294" })]);
  assert.deepEqual(plan.restorable[0]!.fills.map((f) => f.field), ["mobilePhone"]);
  assert.equal(plan.invalid.length, 1);
});

test("a chain A -> B -> C restores onto the root survivor C", () => {
  const plan = planRestoreMergedPhones([
    row("c"),
    row("b", { mergedIntoId: "c" }),
    row("a", { mergedIntoId: "b", phone: "+54 9 11 4590-2294" }),
  ]);
  assert.equal(plan.restorable[0]!.survivorId, "c");
  assert.deepEqual(plan.restorable[0]!.fills[0]!.fromMergedIds, ["a"]);
});

test("a merged row whose target is missing is counted, not guessed", () => {
  const plan = planRestoreMergedPhones([row("orphan", { mergedIntoId: "gone", phone: "+54 9 11 4590-2294" })]);
  assert.equal(plan.restorable.length, 0);
  assert.equal(plan.counts.unresolvedMergedRows, 1);
});

test("a merge cycle terminates and is counted as unresolved", () => {
  const plan = planRestoreMergedPhones([row("x", { mergedIntoId: "y", phone: "+54 9 11 4590-2294" }), row("y", { mergedIntoId: "x" })]);
  assert.equal(plan.restorable.length, 0);
  assert.equal(plan.counts.unresolvedMergedRows, 2);
});

test("per-BD breakdown counts contacts and fills per owner", () => {
  const plan = planRestoreMergedPhones([
    row("a", { ownerBdId: "bd-cristian" }),
    row("a-dup", { mergedIntoId: "a", phone: "+54 9 11 4590-2294", mobilePhone: "+54 (911) 6213 0024" }),
    row("b", { ownerBdId: "bd-macarena" }),
    row("b-dup", { mergedIntoId: "b", phone: "+1 (954) 837-6436" }),
    row("c", { ownerBdId: null }),
    row("c-dup", { mergedIntoId: "c", phone: "+56 2 2938 0805" }),
  ]);
  assert.deepEqual(plan.perBd, [
    { ownerBdId: "bd-cristian", contacts: 1, fills: 2 },
    { ownerBdId: "bd-macarena", contacts: 1, fills: 1 },
    { ownerBdId: null, contacts: 1, fills: 1 },
  ]);
});

test("the report names the contact, the value, the source row and the BD breakdown", () => {
  const plan = planRestoreMergedPhones([
    row("tito", { name: "Tito Picon", ownerBdId: "bd-cristian" }),
    row("tito-dup", { mergedIntoId: "tito", phone: "+54 (11) 4118 8080" }),
  ]);
  const text = formatRestoreReport(plan, new Map([["bd-cristian", "Cristian"]])).join("\n");
  assert.match(text, /Tito Picon/);
  assert.match(text, /tito-dup/);
  assert.match(text, /phone <- \+54 \(11\) 4118 8080/);
  assert.match(text, /Cristian: 1 contact\(s\), 1 fill\(s\)/);
  assert.match(text, /Skipped for a human \(merged rows disagree\): 0/);
});

test("the planner never mutates its input and is repeatable", () => {
  const input = deepFreeze([
    row("s"),
    row("m1", { mergedIntoId: "s", phone: "+54 9 11 4590-2294" }),
    row("m2", { mergedIntoId: "s", phone: "+54 9 11 9999-9999" }),
  ]);
  const first = planRestoreMergedPhones(input);
  const second = planRestoreMergedPhones(input);
  assert.deepEqual(second, first);
});
