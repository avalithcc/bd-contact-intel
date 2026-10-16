import assert from "node:assert/strict";
import { test } from "node:test";
import { LAST_SEEN_THROTTLE_MS, recordBdSeen, shouldTouchLastSeen } from "@/lib/auth/lastSeenPolicy";

const NOW = new Date("2026-10-16T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

test("a BD never seen is touched", () => {
  assert.equal(shouldTouchLastSeen(null, NOW), true);
});

test("a BD seen within the throttle window is not touched; one past it is", () => {
  assert.equal(shouldTouchLastSeen(ago(60_000), NOW), false);
  assert.equal(shouldTouchLastSeen(ago(LAST_SEEN_THROTTLE_MS), NOW), false, "exactly at the limit still waits");
  assert.equal(shouldTouchLastSeen(ago(LAST_SEEN_THROTTLE_MS + 1), NOW), true);
});

test("a last-seen value in the future (clock skew) is not touched", () => {
  assert.equal(shouldTouchLastSeen(new Date(NOW.getTime() + 60_000), NOW), false);
});

test("recordBdSeen writes only when due", async () => {
  const written: string[] = [];
  const write = async (id: string) => void written.push(id);
  await recordBdSeen({ id: "fresh", lastSeenAt: ago(1_000) }, NOW, write);
  await recordBdSeen({ id: "stale", lastSeenAt: ago(LAST_SEEN_THROTTLE_MS + 1) }, NOW, write);
  await recordBdSeen({ id: "never", lastSeenAt: null }, NOW, write);
  assert.deepEqual(written, ["stale", "never"]);
});

test("a failing write never throws into the page", async () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    await recordBdSeen({ id: "x", lastSeenAt: null }, NOW, async () => {
      throw new Error("db down");
    });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
});
