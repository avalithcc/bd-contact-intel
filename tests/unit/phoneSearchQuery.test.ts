import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePhoneSearch, PHONE_SUFFIX_LENGTH } from "@/lib/search/phoneQuery";

test("local Argentine forms and the international form reduce to the same significant suffix", () => {
  for (const q of ["11 5555 5555", "1155555555", "011 15 5555 5555", "15 5555 5555", "+54 9 11 5555-5555", "(011) 5555.5555", "+5491155555555"]) {
    const p = parsePhoneSearch(q);
    assert.deepEqual(p, { mode: "suffix", suffix: "55555555", digits: p?.digits }, q);
  }
});

test("6 and 7 digit queries are contains-matches on the raw digits", () => {
  assert.deepEqual(parsePhoneSearch("555-555"), { mode: "contains", digits: "555555" });
  assert.deepEqual(parsePhoneSearch("5555 555"), { mode: "contains", digits: "5555555" });
});

test("anything that is not a phone-looking query is not a phone search", () => {
  for (const q of ["", "   ", "12345", "juan perez", "juan 5555 5555", "abc123456", "5555-5555x", "++5491155555555", "54+91155555555", "1".repeat(16), "%%%%%%%"]) {
    assert.equal(parsePhoneSearch(q), null, q);
  }
});

test("suffix length is the one the migration indexes", () => {
  assert.equal(PHONE_SUFFIX_LENGTH, 8);
});

test("parsePhoneSearch is pure: same input, same output", () => {
  const input = "011 15 5555 5555";
  assert.deepEqual(parsePhoneSearch(input), parsePhoneSearch(input));
});
