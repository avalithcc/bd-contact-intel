import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PERMANENT_BAN_DURATION,
  PERMANENT_BAN_HOURS,
  PERMANENT_BAN_YEARS,
  expectedBanReleaseAt,
  isEffectivelyPermanent,
} from "@/lib/auth/accessRevocation";

const NOW = new Date("2026-11-11T12:00:00Z");

test("the ban duration is a GoTrue duration string covering a century", () => {
  // The failure this pins is a dropped zero: "87600h" is 10 years, "8760h" is
  // one. Both are accepted by the admin API, both report success, and both
  // let the account back in while everyone believes it is gone.
  assert.match(PERMANENT_BAN_DURATION, /^\d+h$/);
  assert.equal(PERMANENT_BAN_DURATION, `${PERMANENT_BAN_HOURS}h`);
  assert.equal(PERMANENT_BAN_YEARS, 100);
  assert.ok(PERMANENT_BAN_HOURS >= 100 * 24 * 365, `${PERMANENT_BAN_HOURS}h is under a century`);
});

test("the expected release instant is a century out and stays a valid timestamp", () => {
  const release = expectedBanReleaseAt(NOW);
  assert.equal(release.getUTCFullYear(), 2126);
  assert.ok(!Number.isNaN(release.getTime()), "release instant must be representable");
});

test("isEffectivelyPermanent accepts a century and rejects every ban that wears off", () => {
  assert.equal(isEffectivelyPermanent(expectedBanReleaseAt(NOW), NOW), true);
  assert.equal(isEffectivelyPermanent(null, NOW), false, "no ban at all");
  // A GoTrue default-ish ban, and the dropped-zero typo: both must read as
  // NOT permanent so the script refuses to report success.
  assert.equal(isEffectivelyPermanent(new Date("2026-11-12T12:00:00Z"), NOW), false, "24h");
  assert.equal(isEffectivelyPermanent(new Date("2027-11-11T12:00:00Z"), NOW), false, "one year");
  assert.equal(isEffectivelyPermanent(new Date("2035-11-11T12:00:00Z"), NOW), false, "nine years");
  // A ban already in the past is not a lockout.
  assert.equal(isEffectivelyPermanent(new Date("2026-01-01T00:00:00Z"), NOW), false, "expired");
});
