/**
 * Unit tests for src/components/toastTimer.ts (tasks.md mockup-parity 2.3).
 * Pure timer state helpers for Toast auto-dismiss with pause on
 * hover/focus — no real timers or DOM, just numeric state transitions, so
 * the pause/resume/expiry logic is fully unit-testable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTimer,
  isExpired,
  pauseTimer,
  resumeTimer,
} from "@/components/toastTimer";

test("createTimer starts running with the full duration", () => {
  const timer = createTimer(5000, 1000);
  assert.equal(timer.remainingMs, 5000);
  assert.equal(timer.startedAt, 1000);
});

test("createTimer throws on a non-positive duration", () => {
  assert.throws(() => createTimer(0, 1000), RangeError);
  assert.throws(() => createTimer(-100, 1000), RangeError);
});

test("isExpired is false before the duration elapses", () => {
  const timer = createTimer(5000, 1000);
  assert.equal(isExpired(timer, 3000), false);
});

test("isExpired is true once the duration elapses", () => {
  const timer = createTimer(5000, 1000);
  assert.equal(isExpired(timer, 6000), true);
});

test("pauseTimer freezes the remaining time and stops the clock", () => {
  const timer = createTimer(5000, 1000);
  const paused = pauseTimer(timer, 3000);
  assert.equal(paused.remainingMs, 3000);
  assert.equal(paused.startedAt, null);
  // Time passing further while paused must not expire it.
  assert.equal(isExpired(paused, 60_000), false);
});

test("pauseTimer is a no-op when already paused", () => {
  const timer = createTimer(5000, 1000);
  const paused = pauseTimer(timer, 3000);
  const pausedAgain = pauseTimer(paused, 9000);
  assert.deepEqual(pausedAgain, paused);
});

test("resumeTimer restarts the clock with the remaining time", () => {
  const timer = createTimer(5000, 1000);
  const paused = pauseTimer(timer, 3000);
  const resumed = resumeTimer(paused, 10_000);
  assert.equal(resumed.remainingMs, 3000);
  assert.equal(resumed.startedAt, 10_000);
  assert.equal(isExpired(resumed, 12_999), false);
  assert.equal(isExpired(resumed, 13_000), true);
});

test("resumeTimer is a no-op when already running", () => {
  const timer = createTimer(5000, 1000);
  const resumedAgain = resumeTimer(timer, 2000);
  assert.deepEqual(resumedAgain, timer);
});
