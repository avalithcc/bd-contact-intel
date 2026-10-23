import assert from "node:assert/strict";
import { test } from "node:test";
import { draftVersion, parseDraftVersion } from "@/lib/sequences/draftVersion";

const T0 = new Date("2026-10-23T12:00:00.000Z");
const T1 = new Date("2026-10-23T12:00:05.000Z");
const T2 = new Date("2026-10-23T12:00:09.000Z");

test("the version changes on a save-edit", () => {
  assert.notEqual(draftVersion(T0, null), draftVersion(T0, T1));
  assert.notEqual(draftVersion(T0, T1), draftVersion(T0, T2));
});

test("the version changes on a regenerate that also clears editedAt", () => {
  assert.notEqual(draftVersion(T0, T1), draftVersion(T2, null));
});

test("two consecutive regenerations differ although editedAt stays null in both", () => {
  assert.notEqual(draftVersion(T0, null), draftVersion(T1, null));
});

test("the version round-trips through the parser and a malformed one is refused", () => {
  assert.deepEqual(parseDraftVersion(draftVersion(T0, T1)), { generatedMs: T0.getTime(), editedMs: T1.getTime() });
  assert.deepEqual(parseDraftVersion(draftVersion(T0, null)), { generatedMs: T0.getTime(), editedMs: 0 });
  for (const bad of [undefined, null, "", "abc", "1:", "1.5:2", "1:2:3", 5, "-1:0", "99999999999999999999:0", "1:99999999999999999999"]) assert.equal(parseDraftVersion(bad), null, String(bad));
});

test("sub-second differences count: a version built from whole seconds would not see them", () => {
  const a = new Date("2026-10-23T12:00:00.123Z");
  const b = new Date("2026-10-23T12:00:00.124Z");
  assert.notEqual(draftVersion(a, null), draftVersion(b, null));
  assert.notEqual(draftVersion(T0, a), draftVersion(T0, b));
  assert.deepEqual(parseDraftVersion(draftVersion(a, b)), { generatedMs: a.getTime(), editedMs: b.getTime() });
  assert.equal(a.getTime() % 1000, 123);
});
