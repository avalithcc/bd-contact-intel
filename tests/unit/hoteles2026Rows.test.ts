import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeHotelPhone, parseHotelRows } from "@/lib/hoteles2026/rows";
import { BASE, HEADERS, sheetCsv } from "./hoteles2026Fixtures";

test("parses by header name, drops Campaigns, reports ignored columns", () => {
  const csv = sheetCsv([{ ...BASE, Campaigns: "UPDATED (v1.5) MAIL - Steph, CONNECTION - CARLOS", Website: "https://x.example/" }]);
  const out = parseHotelRows(csv);
  assert.equal(out.rowsRead, 1);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]!.email, "ana@hotel-uno.example");
  assert.equal(JSON.stringify(out.rows[0]).includes("Steph"), false);
  assert.deepEqual(out.ignoredColumns, ["Website", "Industry", "Number of employees", "Company LinkedIn URL", "Contact country", "Campaigns"]);
});

test("column order does not matter", () => {
  const reordered = [...HEADERS].reverse();
  const out = parseHotelRows(sheetCsv([BASE], reordered));
  assert.equal(out.rows[0]!.firstName, "Ana");
  assert.equal(out.rows[0]!.contactType, "BUYER-CHAMPION");
});

test("a missing required header throws instead of mis-mapping", () => {
  const without = HEADERS.filter((h) => h !== "TYPE OF CONTACT");
  assert.throws(() => parseHotelRows(sheetCsv([BASE], without)), /TYPE OF CONTACT/);
});

test("handles BOM, CRLF, quoted commas and padded values", () => {
  const csv = "﻿" + sheetCsv([{ ...BASE, "Company name": "Palacio Arriluce Hotel, Member of The Leading Hotels of the World", "First name": " Ana " }]);
  const row = parseHotelRows(csv).rows[0]!;
  assert.equal(row.company, "Palacio Arriluce Hotel, Member of The Leading Hotels of the World");
  assert.equal(row.firstName, "Ana");
});

test("blank and malformed emails become null (keyed by LinkedIn instead)", () => {
  const out = parseHotelRows(sheetCsv([{ ...BASE, "Professional email": "" }, { ...BASE, "Professional email": "not-an-email" }]));
  assert.deepEqual(out.rows.map((r) => r.email), [null, null]);
  assert.deepEqual(out.rows.map((r) => r.emailNormalized), [null, null]);
});

test("email is lowercased into emailNormalized, original casing kept", () => {
  const row = parseHotelRows(sheetCsv([{ ...BASE, "Professional email": "Ana@Hotel-Uno.Example" }])).rows[0]!;
  assert.equal(row.email, "Ana@Hotel-Uno.Example");
  assert.equal(row.emailNormalized, "ana@hotel-uno.example");
});

test("rows without a first or last name are skipped with a reason", () => {
  const out = parseHotelRows(sheetCsv([{ ...BASE, "Last name": "" }, BASE]));
  assert.deepEqual(out.skipped, [{ line: 1, reason: "no_name" }]);
  assert.equal(out.rows[0]!.line, 2);
});

test("contact type is validated at the boundary: unknown values skip the row", () => {
  const out = parseHotelRows(sheetCsv([{ ...BASE, "TYPE OF CONTACT": "DECISION-MAKER" }, { ...BASE, "TYPE OF CONTACT": "influencer" }]));
  assert.deepEqual(out.skipped, [{ line: 1, reason: "invalid_contact_type" }]);
  assert.equal(out.rows[0]!.contactType, "INFLUENCER");
});

// Real phone shapes from the sheet. [raw, country, value, normalised, rejected, dialMismatch]
const PHONES: [string, string | null, string | null, string | null, boolean, boolean][] = [
  ["+34 616 01 64 75", "Spain", "+34 616 01 64 75", null, false, false],
  ["+34  616 01   64 75", "Spain", "+34 616 01 64 75", "collapsed_whitespace", false, false],
  ["+555579072182", "Mexico", "+555579072182", null, false, true], // +55 is Brazil, row says Mexico
  ["34900202000", "Spain", "+34900202000", "added_plus", false, false],
  ["34900202000", null, "34900202000", null, false, false], // no country, no evidence: untouched
  ["900202000", "Spain", "900202000", null, false, true], // no prefix to add: stored as entered
  ["+52 998 147 5845", "Mexico", "+52 998 147 5845", null, false, false],
  ["+1 305-555-0100", "Spain", "+1 305-555-0100", null, false, true],
  ["+39 338 661 5354", "Italy", "+39 338 661 5354", null, false, false],
  ["+506 8888 8888", "Costa Rica", "+506 8888 8888", null, false, false],
  ["", "Spain", null, null, false, false],
  ["   ", "Spain", null, null, false, false],
  ["12345", "Spain", null, null, true, false], // too few digits
  ["call me", "Spain", null, null, true, false],
  ["+34 616+01", "Spain", null, null, true, false],
];

for (const [raw, country, value, normalised, rejected, dialMismatch] of PHONES) {
  test(`normalizeHotelPhone(${JSON.stringify(raw)}, ${country})`, () => {
    assert.deepEqual(normalizeHotelPhone(raw, country), { value, normalised, rejected, dialMismatch });
  });
}

test("normalizeHotelPhone treats null/undefined as no phone", () => {
  assert.equal(normalizeHotelPhone(null, "Spain").value, null);
  assert.equal(normalizeHotelPhone(undefined, "Spain").rejected, false);
});

test("phone and mobile map to separate fields", () => {
  const row = parseHotelRows(sheetCsv([{ ...BASE, "Phone number": "+34 946 18 11 56" }])).rows[0]!;
  assert.equal(row.phone.value, "+34 946 18 11 56");
  assert.equal(row.mobilePhone.value, "+34 616 01 64 75");
});
