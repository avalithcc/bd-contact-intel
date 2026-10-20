import assert from "node:assert/strict";
import { test } from "node:test";
import { BUSY_RECHECK_MS, createLiveController, ECHO_MS, initialConnection, stepConnection } from "@/lib/shell/liveController";
import type { LiveChange } from "@/lib/shell/liveRelevance";

const change: LiveChange = { kind: "task", op: "INSERT", ids: {}, bdId: null, bulk: false };

/** A manual clock: timers fire only when `advance` passes their time, in order. */
function harness(over: { busy?: boolean; hidden?: boolean; relevant?: boolean } = {}) {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const state = { busy: over.busy ?? false, hidden: over.hidden ?? false, relevant: over.relevant ?? true, refreshes: [] as number[] };
  const controller = createLiveController({
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (h) => void timers.delete(h as number),
    refresh: () => void state.refreshes.push(now),
    isBusy: () => state.busy,
    isHidden: () => state.hidden,
    relevant: () => state.relevant,
    debounceMs: () => 400,
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { controller, state, advance, timers };
}

test("a relevant message refreshes once after the debounce, and a burst collapses into that one refresh", () => {
  const h = harness();
  h.controller.onChange(change);
  h.advance(399);
  assert.equal(h.state.refreshes.length, 0);
  h.controller.onChange(change);
  h.controller.onChange(change);
  h.advance(399);
  assert.equal(h.state.refreshes.length, 0, "each message of a burst pushes the refresh back");
  h.advance(1);
  assert.equal(h.state.refreshes.length, 1);
  h.advance(60_000);
  assert.equal(h.state.refreshes.length, 1);
});

test("an irrelevant message never refreshes", () => {
  const h = harness({ relevant: false });
  h.controller.onChange(change);
  h.advance(10_000);
  assert.equal(h.state.refreshes.length, 0);
});

test("an idle tab with no messages never refreshes, however long it stays open", () => {
  const h = harness();
  h.advance(10 * 60_000);
  assert.deepEqual(h.state.refreshes, []);
  assert.equal(h.timers.size, 0, "nothing is scheduled while idle");
});

test("a busy screen holds the refresh and runs it as soon as it is idle", () => {
  const h = harness({ busy: true });
  h.controller.onChange(change);
  h.advance(5_000);
  assert.equal(h.state.refreshes.length, 0);
  assert.equal(h.controller.pending, true);
  h.state.busy = false;
  h.controller.onIdle();
  h.advance(400);
  assert.equal(h.state.refreshes.length, 1);
  assert.equal(h.controller.pending, false);
});

test("a busy screen that goes idle without an event is still caught by the local re-check", () => {
  const h = harness({ busy: true });
  h.controller.onChange(change);
  h.advance(400);
  h.state.busy = false;
  h.advance(BUSY_RECHECK_MS);
  assert.equal(h.state.refreshes.length, 1);
});

test("a hidden tab holds the refresh until it becomes visible", () => {
  const h = harness({ hidden: true });
  h.controller.onChange(change);
  h.advance(60_000);
  assert.equal(h.state.refreshes.length, 0);
  h.state.hidden = false;
  h.controller.onIdle();
  h.advance(400);
  assert.equal(h.state.refreshes.length, 1);
});

test("a message right after a refresh is not lost: it refreshes once, trailing, after the echo window", () => {
  const h = harness();
  h.controller.onChange(change);
  h.advance(400);
  assert.equal(h.state.refreshes.length, 1);
  h.advance(300);
  h.controller.onChange(change);
  h.advance(ECHO_MS - 301);
  assert.equal(h.state.refreshes.length, 1, "still inside the echo window");
  h.advance(2);
  assert.equal(h.state.refreshes.length, 2, "the trailing refresh runs right after the window");
  h.advance(60_000);
  assert.equal(h.state.refreshes.length, 2);
});

test("catching up after a reconnect refreshes exactly once, even without a message and inside the echo window", () => {
  const h = harness();
  h.controller.onChange(change);
  h.advance(400);
  h.controller.catchUp();
  h.controller.catchUp();
  h.advance(400);
  assert.equal(h.state.refreshes.length, 2);
});

test("a catch-up on a hidden tab waits for the tab to be visible", () => {
  const h = harness({ hidden: true });
  h.controller.catchUp();
  h.advance(30_000);
  assert.equal(h.state.refreshes.length, 0);
  h.state.hidden = false;
  h.controller.onIdle();
  h.advance(400);
  assert.equal(h.state.refreshes.length, 1);
});

test("navigating drops what was pending (the new page is already fresh) and dispose stops everything", () => {
  const h = harness({ busy: true });
  h.controller.onChange(change);
  h.controller.reset();
  h.state.busy = false;
  h.advance(10_000);
  assert.equal(h.state.refreshes.length, 0);
  h.controller.onChange(change);
  h.controller.dispose();
  h.advance(10_000);
  assert.equal(h.state.refreshes.length, 0);
  assert.equal(h.timers.size, 0);
});

test("connection steps: a rejoin after a drop asks for exactly one catch-up", () => {
  let s = initialConnection;
  let r = stepConnection(s, "SUBSCRIBED");
  assert.equal(r.catchUp, false, "the first join needs no catch-up");
  s = r.next;
  r = stepConnection(s, "CLOSED");
  assert.equal(r.catchUp, false);
  s = r.next;
  r = stepConnection(s, "SUBSCRIBED");
  assert.equal(r.catchUp, true);
  s = r.next;
  assert.equal(stepConnection(s, "SUBSCRIBED").catchUp, false);
});

test("connection steps: a channel that never joins is given up on, a flaky one that did join is not", () => {
  let s = initialConnection;
  const outcomes: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    const r = stepConnection(s, "CHANNEL_ERROR");
    outcomes.push(r.giveUp);
    s = r.next;
  }
  assert.deepEqual(outcomes, [false, false, false, true, true]);
  let joined = stepConnection(initialConnection, "SUBSCRIBED").next;
  for (let i = 0; i < 20; i++) {
    const r = stepConnection(joined, "TIMED_OUT");
    assert.equal(r.giveUp, false);
    joined = r.next;
  }
});

test("stepConnection does not mutate its input", () => {
  const input = Object.freeze({ ...initialConnection });
  assert.deepEqual(stepConnection(input, "CHANNEL_ERROR"), stepConnection(input, "CHANNEL_ERROR"));
});
