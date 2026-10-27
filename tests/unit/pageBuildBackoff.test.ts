/**
 * The /follow-ups page builds today's queue at most once per instance and day after a success, and retries a FAILED build, but not
 * more than once per PAGE_BUILD_RETRY_MS (a database that is down must not be hit by the heavy selection on every visit).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_BUILD_RETRY_MS, shouldAttemptPageBuild } from "@/lib/followUp/pageBuildBackoff";

const T0 = Date.parse("2026-10-27T12:00:00Z");

test("never attempted: attempt", () => {
  assert.equal(shouldAttemptPageBuild(undefined, T0), true);
});

test("already built today: never attempt again", () => {
  assert.equal(shouldAttemptPageBuild({ status: "built" }, T0 + 10 * PAGE_BUILD_RETRY_MS), false);
});

test("failed: wait five minutes, then retry", () => {
  assert.equal(PAGE_BUILD_RETRY_MS, 5 * 60 * 1000);
  const failed = { status: "failed", at: T0 } as const;
  assert.equal(shouldAttemptPageBuild(failed, T0 + 1), false);
  assert.equal(shouldAttemptPageBuild(failed, T0 + PAGE_BUILD_RETRY_MS - 1), false);
  assert.equal(shouldAttemptPageBuild(failed, T0 + PAGE_BUILD_RETRY_MS), true);
});
