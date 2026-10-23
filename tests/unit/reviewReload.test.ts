import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_RELOAD, reloadKey, reloadReducer, type ReloadEvent, type ReloadState } from "@/lib/sequences/reviewReload";

const run = (events: ReloadEvent[], from: ReloadState = INITIAL_RELOAD) => events.reduce(reloadReducer, from);
const K = reloadKey("m1", 1);
const V1 = { version: "1:0" };
const click: ReloadEvent = { type: "click", key: K, marker: V1 };
const props = (over: Partial<Extract<ReloadEvent, { type: "props" }>> = {}): ReloadEvent => ({ type: "props", open: true, key: K, marker: V1, ...over });

test("a click makes the reload pending, and unchanged props keep it pending without touching state", () => {
  const pending = run([click]);
  assert.ok(pending.pending);
  assert.equal(reloadReducer(pending, props()), pending, "same marker: nothing arrived yet, same reference (no render loop)");
});

test("the refetch answering with the SAME version still ends the reload and re-reports once (the stuck state)", () => {
  // Another action already refreshed V2 into the props; the refetch returns V2 again as a new object.
  const sameVersionNewObject = { version: "1:0" };
  const done = run([click, props({ marker: sameVersionNewObject })]);
  assert.equal(done.pending, null);
  assert.equal(done.reads, 1);
  assert.equal(reloadReducer(done, props({ marker: { version: "1:0" } })), done, "a later refresh without a click never re-reports");
});

test("closing mid-reload clears it, so reopening the same draft starts clean and does not re-report", () => {
  const closed = run([click, props({ open: false })]);
  assert.deepEqual(closed, { pending: null, reads: 0 });
  assert.deepEqual(run([props({ marker: { version: "x" } })], closed), closed);
});

test("showing another draft clears the reload and never reports twice", () => {
  const other = run([click, props({ key: reloadKey("m2", 1), marker: { version: "2:0" } })]);
  assert.deepEqual(other, { pending: null, reads: 0 });
  assert.equal(run([click, props({ key: reloadKey("m1", 2), marker: {} })]).reads, 0, "the reminder of the same member is another draft");
});

test("a refetch that never answers is released by the timeout, without a re-report", () => {
  assert.deepEqual(run([click, { type: "timeout" }]), { pending: null, reads: 0 });
  assert.equal(reloadReducer(INITIAL_RELOAD, { type: "timeout" }), INITIAL_RELOAD);
});

test("two reloads in a row each re-report once", () => {
  assert.equal(run([click, props({ marker: { a: 1 } }), { ...click, marker: { a: 1 } }, props({ marker: { a: 2 } })]).reads, 2);
});
