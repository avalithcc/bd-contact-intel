/**
 * Planner behind scripts/restore-normalized-merged-phones.ts: the survivor
 * whose stranded phone was dot-separated and so skipped by the first restore
 * and by the E.164 backfill (merged-away rows are not processed). Synthetic ids
 * and numbers.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planNormalizedMergedPhones,
  type NormalizableRestoreRow,
} from "@/lib/identity/restoreNormalizedMergedPhones";

function row(id: string, o: Partial<NormalizableRestoreRow> = {}): NormalizableRestoreRow {
  return { id, name: id, ownerBdId: "bd-a", phone: null, mobilePhone: null, mergedIntoId: null, sourceKey: null, country: null, ...o };
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.freeze(v);
    for (const k of Object.values(v)) deepFreeze(k);
  }
  return v;
}

test("a dotted +54.9.11 stranded value is normalized to E.164 and fills the survivor", () => {
  const result = planNormalizedMergedPhones([
    row("s1"),
    row("m1", { mergedIntoId: "s1", mobilePhone: "+54.9.11.5555.5555" }),
  ]);
  assert.equal(result.plan.restorable.length, 1);
  assert.deepEqual(result.plan.restorable[0]!.fills, [{ field: "mobilePhone", value: "+5491155555555", fromMergedIds: ["m1"] }]);
  assert.deepEqual(result.normalized, [{ mergedId: "m1", field: "mobilePhone", from: "+54.9.11.5555.5555", to: "+5491155555555", rule: "separators_stripped" }]);
});

test("a country is never guessed: only values with an explicit + are considered, the rest are skipped", () => {
  for (const raw of ["5555.5555", "011.5555.5555", "00.54.9.11.5555.5555", "54.9.11.5555.5555"]) {
    const result = planNormalizedMergedPhones([row("s1"), row("m1", { mergedIntoId: "s1", phone: raw })]);
    assert.equal(result.plan.restorable.length, 0, raw);
    assert.equal(result.normalized.length, 0, raw);
    assert.deepEqual(result.skipped, [{ mergedId: "m1", field: "phone" }], raw);
  }
});

test("the survivor's Argentine context does not turn a plus-less number into an Argentine one", () => {
  const result = planNormalizedMergedPhones([
    row("s1"),
    row("m1", { mergedIntoId: "s1", mobilePhone: "11.5555.5555", sourceKey: "dff-2026", country: "Argentina" }),
  ]);
  assert.equal(result.plan.restorable.length, 0);
  assert.equal(result.skipped.length, 1);
});

test("a plus value that is not a valid number is unresolved, not skipped", () => {
  const result = planNormalizedMergedPhones([row("s1"), row("m1", { mergedIntoId: "s1", phone: "+54.9.11.1" })]);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.unresolved.length, 1);
});

test("survivors whose merged values were already valid are left to the original script", () => {
  const result = planNormalizedMergedPhones([
    row("s1"),
    row("m1", { mergedIntoId: "s1", phone: "+54 11 4555 5555" }),
  ]);
  assert.equal(result.plan.restorable.length, 0);
});

test("a survivor that already has a phone is untouched", () => {
  const result = planNormalizedMergedPhones([
    row("s1", { phone: "+5411 1111 1111" }),
    row("m1", { mergedIntoId: "s1", mobilePhone: "+54.9.11.5555.5555" }),
  ]);
  assert.equal(result.plan.restorable.length, 0);
});

test("the planner never mutates its input and is repeatable", () => {
  const rows = deepFreeze([row("s1"), row("m1", { mergedIntoId: "s1", mobilePhone: "+54.9.11.5555.5555" })]);
  const a = planNormalizedMergedPhones(rows);
  const b = planNormalizedMergedPhones(rows);
  assert.deepEqual(a, b);
  assert.equal(rows[1]!.mobilePhone, "+54.9.11.5555.5555");
});
