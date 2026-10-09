import { test } from "node:test";
import assert from "node:assert/strict";
import { isJunkCompanyKey } from "@/lib/companyMerge/junkKey";

// The 2026-10-08 incident: "АО «Системы управления»" and "مؤسسه تراتيل" were detached as junk because the
// squash of a non-Latin name is "" and "" sat in the junk set. Every script below is a REAL employer.
test("isJunkCompanyKey: a name in any non-Latin script is a company, never junk", () => {
  for (const name of [
    "АО «Системы управления»", // Cyrillic
    "مؤسسه تراتيل", // Arabic
    "חברת החשמל", // Hebrew
    "日本", // CJK, two characters
    "서울", // Korean
    "Ελλάδα", // Greek
    "บริษัท ไทย", // Thai
  ]) {
    assert.equal(isJunkCompanyKey(name), false, name);
  }
});

test("isJunkCompanyKey: Latin names with accents or non-ASCII letters are companies", () => {
  assert.equal(isJunkCompanyKey("Universidad Autónoma de Nuevo León"), false);
  assert.equal(isJunkCompanyKey("São Paulo"), false);
});

test("isJunkCompanyKey: placeholders and punctuation are junk", () => {
  for (const key of ["", "-", ".", "(sin dato)", "Sin Dato", "na", "N/A", "none", "null", "d", "   ", "---", "«»"]) {
    assert.equal(isJunkCompanyKey(key), true, JSON.stringify(key));
  }
});

test("isJunkCompanyKey: a two-letter real name is not junk just for being short", () => {
  assert.equal(isJunkCompanyKey("HP"), false);
  assert.equal(isJunkCompanyKey("3M"), false);
});
