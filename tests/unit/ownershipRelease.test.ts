import assert from "node:assert/strict";
import { test } from "node:test";
import { unmarkedReleases, verifyPersonRelease } from "@/lib/auth/ownershipRelease";

test("a released person with no manual-owner marker is reported, not silently released", () => {
  // The failure this pins: the row is nulled, the script prints "released",
  // and the 03:00 owner recompute hands that person back to the BD who just
  // left — because the last BD who worked them IS her.
  const toUpdate = ["p1", "p2", "p3"];
  const history = [{ personId: "p1" }, { personId: "p3" }];
  assert.deepEqual(unmarkedReleases(toUpdate, history), ["p2"]);
});

test("every released person marked means nothing to report", () => {
  const toUpdate = ["p1", "p2"];
  assert.deepEqual(unmarkedReleases(toUpdate, [{ personId: "p2" }, { personId: "p1" }]), []);
  assert.deepEqual(unmarkedReleases([], []), []);
});

test("rows still pointing at the departing BD fail the read-back", () => {
  const result = verifyPersonRelease({ releasedCount: 4719, remainingOwned: 12, markersWritten: 4719 });
  assert.equal(result.ok, false);
  assert.match(result.problem ?? "", /still point at the departing BD/);
});

test("fewer markers than released rows fails the read-back", () => {
  // THE load-bearing case. Both other numbers look perfect here: every row
  // was nulled and nothing still points at her. Accepting this reports a
  // completed offboarding for people the nightly cron re-owns tonight, and
  // for a change set far over the cron's 25-change cap, which then fails the
  // whole recompute every night.
  const result = verifyPersonRelease({ releasedCount: 4719, remainingOwned: 0, markersWritten: 4718 });
  assert.equal(result.ok, false);
  assert.match(result.problem ?? "", /nightly owner recompute/);

  // One marker short of nothing is still short.
  assert.equal(verifyPersonRelease({ releasedCount: 1, remainingOwned: 0, markersWritten: 0 }).ok, false);
});

test("zero remaining and a marker per released row is the only success", () => {
  assert.deepEqual(verifyPersonRelease({ releasedCount: 4719, remainingOwned: 0, markersWritten: 4719 }), {
    ok: true,
    problem: null,
  });
  // Nothing to release is a legitimate success (a re-run after the first one).
  assert.equal(verifyPersonRelease({ releasedCount: 0, remainingOwned: 0, markersWritten: 0 }).ok, true);
});
