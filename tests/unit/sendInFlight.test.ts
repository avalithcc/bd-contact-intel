import assert from "node:assert/strict";
import { test } from "node:test";
import { createInFlight, type InFlightKind } from "@/lib/sendSchedule/inFlight";

function setup() {
  const seen: (InFlightKind | null)[] = [];
  return { seen, guard: createInFlight((k) => seen.push(k)) };
}

test("run reports busy then idle around the work and returns its result", async () => {
  const { seen, guard } = setup();
  assert.equal(await guard.run("send", async () => 42), 42);
  assert.deepEqual(seen, ["send", null]);
  assert.equal(guard.current, null);
});

test("a second call while one is in flight is ignored", async () => {
  const { seen, guard } = setup();
  let calls = 0;
  let release!: () => void;
  const first = guard.run("send", () => new Promise<void>((r) => { calls++; release = r; }));
  assert.equal(guard.current, "send");
  assert.equal(await guard.run("schedule", async () => { calls++; }), undefined);
  release();
  await first;
  assert.equal(calls, 1);
  assert.deepEqual(seen, ["send", null]);
});

test("a throwing call still settles back to idle and can run again", async () => {
  const { seen, guard } = setup();
  await assert.rejects(guard.run("schedule", async () => { throw new Error("boom"); }), /boom/);
  assert.equal(guard.current, null);
  assert.equal(await guard.run("send", () => "ok"), "ok");
  assert.deepEqual(seen, ["schedule", null, "send", null]);
});
