import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTACT_TYPES, parseContactType } from "@/lib/contacts/contactType";

test("CONTACT_TYPES lists exactly the two values the hotel sheet carries", () => {
  assert.deepEqual([...CONTACT_TYPES], ["BUYER-CHAMPION", "INFLUENCER"]);
});

const CASES: [string, string | null][] = [
  ["BUYER-CHAMPION", "BUYER-CHAMPION"],
  ["INFLUENCER", "INFLUENCER"],
  ["  buyer-champion ", "BUYER-CHAMPION"],
  ["Influencer", "INFLUENCER"],
  ["buyer champion", null],
  ["BUYER_CHAMPION", null],
  ["DECISION-MAKER", null],
  ["", null],
  ["   ", null],
];

for (const [raw, expected] of CASES) {
  test(`parseContactType(${JSON.stringify(raw)}) -> ${JSON.stringify(expected)}`, () => {
    assert.equal(parseContactType(raw), expected);
  });
}

test("parseContactType treats null/undefined as no value", () => {
  assert.equal(parseContactType(null), null);
  assert.equal(parseContactType(undefined), null);
});
