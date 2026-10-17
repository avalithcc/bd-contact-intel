import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTACT_TYPES, contactTypeLabel } from "@/lib/contacts/contactType";
import { buildActiveFilterChips } from "@/lib/contacts/filterChips";
import { SENIORITY_KEYS, normalizeSeniorityKey, seniorityLabel, seniorityOptions } from "@/lib/contacts/seniority";
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

const PRODUCTION_SENIORITIES: [stored: string, es: string, en: string][] = [
  ["Senior", "Senior", "Senior"],
  ["Manager", "Gerente", "Manager"],
  ["Owner", "Propietario", "Owner"],
  ["CLevel", "C-Level", "C-Level"],
  ["Director", "Director", "Director"],
  ["Partner", "Socio", "Partner"],
  ["VP", "VP", "VP"],
  ["Junior", "Junior", "Junior"],
  ["Assistant C-Level", "Asistente de C-Level", "C-Level assistant"],
];

test("every seniority value found in production maps to a label in es and en", () => {
  for (const [stored, labelEs, labelEn] of PRODUCTION_SENIORITIES) {
    assert.equal(seniorityLabel(stored, es.seniorities), labelEs, stored);
    assert.equal(seniorityLabel(stored, en.seniorities), labelEn, stored);
  }
  assert.equal(seniorityLabel("", es.seniorities), "—");
});

test("seniority filter options send the raw stored value and only localize the text", () => {
  const stored = PRODUCTION_SENIORITIES.map(([s]) => s);
  const options = seniorityOptions(stored, es.seniorities);
  assert.deepEqual(options.map((o) => o.value), stored);
  assert.deepEqual(options.find((o) => o.value === "CLevel"), { value: "CLevel", label: "C-Level" });
});

test("a seniority chip shows the label but the filter value stays the stored one", () => {
  const filters = { seniority: "CLevel" };
  const chips = buildActiveFilterChips(filters, {
    ownerLabel: (v) => v,
    statusLabel: (s) => s,
    emailStatusLabel: (s) => s,
    marketLabel: (m) => m,
    roleGroupLabel: (k) => k,
    bdName: (id) => id,
    seniorityLabel: (v) => seniorityLabel(v, es.seniorities),
  });
  assert.equal(chips[0].field, "seniority");
  assert.equal(chips[0].valueText, "C-Level");
  assert.equal(filters.seniority, "CLevel");
});
