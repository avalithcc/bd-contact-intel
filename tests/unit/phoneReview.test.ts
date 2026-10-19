import assert from "node:assert/strict";
import { test } from "node:test";
import { E164_SHAPE_SQL_PATTERN, anyPhoneNeedsReview, phoneNeedsReview, phoneReviewVariant } from "@/lib/phoneReview";
import { normalizePhoneForWrite } from "@/lib/phoneNormalize";

test("phoneNeedsReview: E.164 shape is clean, blank is not flagged", () => {
  assert.equal(phoneNeedsReview("+5491155555555"), false);
  assert.equal(phoneNeedsReview("+14155550123"), false);
  assert.equal(phoneNeedsReview(null), false);
  assert.equal(phoneNeedsReview(undefined), false);
  assert.equal(phoneNeedsReview(""), false);
  assert.equal(phoneNeedsReview("   "), false);
});

test("phoneNeedsReview: anything else non-blank is flagged, no country is guessed", () => {
  for (const v of ["1141234567", "011 4123-4567", "+54 9 11 5555 5555", "+54 11 99", "+0123456789", "+5491155555555 ext 3", "+12345678901234567"]) {
    assert.equal(phoneNeedsReview(v), true, v);
  }
});

test("anyPhoneNeedsReview looks at both columns", () => {
  assert.equal(anyPhoneNeedsReview("+5491155555555", "1141234567"), true);
  assert.equal(anyPhoneNeedsReview("+5491155555555", null), false);
  assert.equal(anyPhoneNeedsReview(null, null), false);
});

test("phoneReviewVariant: a leading + means the country is there but the number did not validate", () => {
  assert.equal(phoneReviewVariant("1141234567"), "no_country");
  assert.equal(phoneReviewVariant(" +54 11 99"), "unrecognized");
});

test("the SQL pattern is the very same regex as the client rule", () => {
  assert.equal(E164_SHAPE_SQL_PATTERN, "^\\+[1-9][0-9]{6,14}$");
});

test("a valid number saved through the write path stops being flagged", () => {
  const stored = normalizePhoneForWrite("+54 9 11 5555 5555", { column: "phone" });
  assert.equal(phoneNeedsReview(stored), false);
});
