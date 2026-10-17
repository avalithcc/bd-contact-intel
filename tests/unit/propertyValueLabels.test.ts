import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTACT_TYPES, contactTypeLabel } from "@/lib/contacts/contactType";
import { SENIORITY_KEYS, normalizeSeniorityKey, seniorityLabel } from "@/lib/contacts/seniority";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

test("both dictionaries label every contact type and every seniority key", () => {
  for (const d of [es, en]) {
    assert.deepEqual(Object.keys(d.contactTypes).sort(), [...CONTACT_TYPES].sort());
    assert.deepEqual(Object.keys(d.seniorities).sort(), [...SENIORITY_KEYS].sort());
  }
});

test("seniorityLabel maps snake_case, hyphenated and cased variants of a known value", () => {
  assert.equal(seniorityLabel("c_level", es.seniorities), "C-Level");
  assert.equal(seniorityLabel("C-Level", en.seniorities), "C-Level");
  assert.equal(seniorityLabel("  SENIOR ", es.seniorities), "Senior");
  assert.equal(seniorityLabel("manager", es.seniorities), "Gerente");
  assert.equal(seniorityLabel("manager", en.seniorities), "Manager");
});

test("seniorityLabel falls back to the raw value for unknown text and to the empty marker for blanks", () => {
  assert.equal(seniorityLabel("Head of Everything", es.seniorities), "Head of Everything");
  assert.equal(seniorityLabel(null, es.seniorities), "—");
  assert.equal(seniorityLabel("   ", es.seniorities, "n/a"), "n/a");
});

test("normalizeSeniorityKey collapses separators", () => {
  assert.equal(normalizeSeniorityKey(" C-Level "), "c_level");
  assert.equal(normalizeSeniorityKey("c  level"), "c_level");
});

test("contactTypeLabel uses the dictionary labels when given, and keeps unknown values raw", () => {
  assert.equal(contactTypeLabel("BUYER-CHAMPION", "—", en.contactTypes), "Buyer / champion");
  assert.equal(contactTypeLabel("INFLUENCER", "—", es.contactTypes), "Influenciador");
  assert.equal(contactTypeLabel("DECISION-MAKER", "—", en.contactTypes), "DECISION-MAKER");
});
