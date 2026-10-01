import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHotelPlan } from "@/lib/hoteles2026/plan";
import { formatHotelReport } from "@/lib/hoteles2026/report";
import { parseHotelRows } from "@/lib/hoteles2026/rows";
import { BASE, sheetCsv } from "./hoteles2026Fixtures";

const plan = () =>
  buildHotelPlan(
    parseHotelRows(sheetCsv([BASE, { ...BASE, "Professional email": "", "LinkedIn profile URL": "https://www.linkedin.com/in/b", "First name": "Beto", "Mobile phone": "34900202000" }])),
    { marielBdId: "b2c7ef1d-cec2-46de-8a33-13c7860bfa17", candidates: [], companyAliasByKey: new Map(), existingCompaniesByKey: new Map() },
  );

test("the report states the counts the owner must check", () => {
  const text = formatHotelReport(plan()).join("\n");
  for (const needle of ["People to CREATE: 2", "Companies to CREATE: 1", "With email: 1   Without email: 1", "BUYER-CHAMPION: 2", "sales_bd: 2", "FRAGILE", "leading '+' added", "(rows 2)", "Columns not imported:"]) {
    assert.ok(text.includes(needle), `missing: ${needle}\n${text}`);
  }
});

test("the report never prints names, emails or phone numbers", () => {
  const text = formatHotelReport(plan()).join("\n");
  for (const pii of ["Ana", "Prueba", "Beto", "hotel-uno.example", "616 01 64 75", "34900202000", "linkedin.com"]) {
    assert.equal(text.includes(pii), false, `leaked: ${pii}`);
  }
});
