import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTACT_TYPES, CONTACT_TYPE_LABELS, contactTypeLabel, parseContactType } from "@/lib/contacts/contactType";

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

test("each stored value has its Spanish label; stored values are untouched", () => {
  assert.equal(CONTACT_TYPE_LABELS["BUYER-CHAMPION"], "Comprador / promotor");
  assert.equal(CONTACT_TYPE_LABELS.INFLUENCER, "Influenciador");
  assert.deepEqual(Object.keys(CONTACT_TYPE_LABELS).sort(), [...CONTACT_TYPES].sort());
});

test("contactTypeLabel maps both values to their label", () => {
  assert.equal(contactTypeLabel("BUYER-CHAMPION"), "Comprador / promotor");
  assert.equal(contactTypeLabel("INFLUENCER"), "Influenciador");
});

test("contactTypeLabel renders an empty value as an em dash, not a 'sin dato' badge text", () => {
  assert.equal(contactTypeLabel(null), "—");
  assert.equal(contactTypeLabel(undefined), "—");
  assert.equal(contactTypeLabel(""), "—");
});

test("contactTypeLabel shows an out-of-vocabulary stored value as-is instead of hiding it", () => {
  assert.equal(contactTypeLabel("DECISION-MAKER"), "DECISION-MAKER");
});
