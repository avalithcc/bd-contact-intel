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

// Real production strings (titles only).
const REAL_CFO_TITLES = [
  "Gerente Financiero/a / Cfo", // x90
  "CFO", // x27
  "CFO - Director de Administración y Finanzas", // x3
  "Co-Founder & CFO", // x3
];

const REAL_FINANCE_DIRECTOR_TITLES = [
  "Director Financiero",
  "Director of Finance",
  "Finance Director South Cone",
  "Directora de Administración y Finanzas",
  "Director financiero adjunto",
  "Sub Director de Administración y Finanzas",
];

test("director-level finance titles classify as c_level_business", () => {
  for (const t of FINANCE_DIRECTOR_TITLES) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
});

test("real CFO titles still classify as c_level_business", () => {
  for (const t of REAL_CFO_TITLES) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
});

test("a CFO who is also CTO stays c_level_tech (earlier group wins)", () => {
  assert.equal(classifyPosition("Co-Founder, CFO & CTO"), "c_level_tech");
});

test("real finance director titles classify as c_level_business", () => {
  for (const t of REAL_FINANCE_DIRECTOR_TITLES) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
});

test("finance + operations directors move from operations to c_level_business (intended)", () => {
  for (const t of ["Director De Finanzas Y Operaciones", "Director Financiero Operaciones", "DIRECTOR DE FINANZAS & OPERACIONES"]) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
});

test("pre-existing: VP of Finance lands in eng_leadership because the vp term matches first", () => {
  assert.equal(classifyPosition("VP of Finance"), "eng_leadership");
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
