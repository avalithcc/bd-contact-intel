/**
 * Director-level finance titles join c_level_business (a Finance Director is
 * the CFO of a smaller company, and the CFOs already live there). Controller
 * titles are NOT C-level and stay in `other` on purpose.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyPosition } from "../../src/lib/roleGroups";

const FINANCE_DIRECTOR_TITLES = [
  "Director financiero",
  "Director Financiero",
  "Directora financiera",
  "Finance Director",
  "Director of Finance",
  "Financial Director",
  "Direttore finanziario",
  "Direttrice finanziaria",
  "Director de Finanzas",
  "Directora de Finanzas",
  "Director de Administración y Finanzas",
  "Finanzdirektor",
  "Directeur financier",
];

const CFO_TITLES = [
  "CFO",
  "cfo",
  "Chief Financial Officer",
  "CFO & Co-Founder",
  "Interim CFO",
  "Group CFO",
  "CFO - Finance",
  "Vice President and CFO",
];

test("director-level finance titles classify as c_level_business", () => {
  for (const t of FINANCE_DIRECTOR_TITLES) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
});

test("CFO titles still classify as c_level_business", () => {
  for (const t of CFO_TITLES) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
});

test("controller titles are deliberately left in other", () => {
  for (const t of ["Financial Controller", "Controller financiero", "Controller Financiero", "Finance Controller"]) {
    assert.equal(classifyPosition(t), "other", t);
  }
});

test("sub-director / assistant forms with a prefix attached are not promoted by word", () => {
  assert.equal(classifyPosition("Subdirector financiero"), "other");
});

test("the finance terms do not route anyone into a hidden group", () => {
  for (const t of FINANCE_DIRECTOR_TITLES) {
    assert.ok(!["developers", "sales_bd"].includes(classifyPosition(t)), t);
  }
});
