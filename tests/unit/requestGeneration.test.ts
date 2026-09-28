/**
 * Unit tests for src/lib/activity/requestGeneration.ts (fix/timeline-filter-
 * no-reload, follow-up review WARNING: a superseded scoped pill fetch could
 * land stale data on the wrong pill — there was no way for a resolving
 * promise to tell it had been overtaken by a newer fetch or a background
 * data refresh).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isRequestCurrent } from "@/lib/activity/requestGeneration";

test("isRequestCurrent: a request whose generation still matches the current one is current", () => {
  assert.equal(isRequestCurrent(1, 1), true);
});

test("isRequestCurrent: a request captured at an OLDER generation is stale", () => {
  assert.equal(isRequestCurrent(1, 2), false);
});

test("isRequestCurrent: the exact race from the review — a busy-contact pill fetch superseded by a refresh's own re-fetch", () => {
  // 1) BD clicks a pill that needs a scoped fetch (busy contact, not
  //    provably complete locally) — `fetchScope` captures generation 1.
  let generation = 0;
  const requestA = ++generation; // fetchScope's own request, captured at start
  assert.equal(requestA, 1);

  // 2) Before it resolves, a note is added elsewhere and `router.refresh()`
  //    fires. The reset effect bumps the generation (it always supersedes
  //    whatever was in flight, per the fix) and — because the still-active
  //    pill is ALSO not provably complete from the fresh pool — starts its
  //    OWN fetch for the same scope.
  generation += 1; // reset effect's own bump (fresh server props arrived)
  const requestB = ++generation; // the reset effect's own fetchScope call
  assert.equal(requestB, 3);

  // 3) request A finally resolves. It must be recognized as stale — it must
  //    NOT be allowed to write cache/activeScope/pendingScope.
  assert.equal(isRequestCurrent(requestA, generation), false);

  // 4) request B resolves and IS still the latest — it's the one allowed to
  //    apply its result.
  assert.equal(isRequestCurrent(requestB, generation), true);
});

test("isRequestCurrent: a second click before the first resolves supersedes it", () => {
  let generation = 0;
  const requestA = ++generation; // click pill A
  const requestB = ++generation; // click pill B before A resolves
  assert.equal(isRequestCurrent(requestA, generation), false);
  assert.equal(isRequestCurrent(requestB, generation), true);
});
