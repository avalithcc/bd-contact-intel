/**
 * `hospitality_revenue` group: revenue / reservations / distribution titles
 * from the hotel import. The rule sits immediately BEFORE `sales_bd`, so it
 * wins over sales_bd and operations but never steals from the earlier groups.
 *
 * REAL_REVENUE_TITLES are the production persons (verbatim titles, no names)
 * the group was built from: 16 persons over 10 distinct titles, plus the one
 * telecom "revenue assurance" title that is deliberately excluded.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLE_GROUPS, classifyPosition } from "../../src/lib/roleGroups";
import { LEADERSHIP_ROLE_GROUPS } from "../../src/lib/hiring/leadership";
import { IT_ROLE_GROUPS } from "../../src/lib/hiring/classify";
import { NOT_WORTH_PRIORITIZING, ROLE_GROUP_PLAYBOOK } from "../../src/lib/roleGroupPlaybook";

const REAL_REVENUE_TITLES = [
  "Revenue Manager", // x6
  "Head of Revenue", // x2
  "Cluster Reservations & Revenue Manager",
  "Reservations Manager | Supporting Revenue Management",
  "Revenue Manager / Reservation Manager",
  "Director of Revenue Management",
  "Assistant Revenue Manager",
  "Revenue - Channel Manager",
  "Directora Revenue & Distribution",
  "E-Commerce & Revenue Manager",
];

const FUTURE_TITLES = [
  "Hotel Distribution Manager",
  "Online Distribution Manager",
  "Yield Manager",
  "Booking Manager",
  "Jefe de Reservas",
  "Jefa de Reservas",
  "Director de Reservas",
  "Directora de Reservas",
  "Gerente de Reservas",
  "Director de Revenue",
  "Responsable de Revenue Management",
];

test("every real revenue/reservations title lands in hospitality_revenue", () => {
  for (const t of [...REAL_REVENUE_TITLES, ...FUTURE_TITLES]) {
    assert.equal(classifyPosition(t), "hospitality_revenue", t);
  }
});

test("mixed titles move out of the hidden sales_bd group into the visible one", () => {
  assert.equal(classifyPosition("Senior Revenue Manager & Sales"), "hospitality_revenue");
  assert.equal(classifyPosition("Jefe de Marketing and Revenue Manager"), "hospitality_revenue");
});

test("Revenue Operations (SaaS function) stays in operations", () => {
  assert.equal(classifyPosition("Director of Revenue Operations"), "operations");
});

test("revenue assurance (telecom audit/finance) is not hotel revenue management", () => {
  assert.equal(classifyPosition("Sub Gerente Revenue Assurance y Modelos"), "other");
  assert.equal(classifyPosition("Gerente de Revenue Assurance"), "other");
});

test("bare 'reservas' is deliberately NOT a term", () => {
  assert.equal(classifyPosition("Agente De Reservas"), "other");
  assert.equal(classifyPosition("Banco de Reservas"), "other");
});

test("ambiguous bare 'distribution manager' stays out (logistics false positive)", () => {
  assert.equal(classifyPosition("Distribution Manager"), "other");
});

test("earlier groups still win over the new rule", () => {
  assert.equal(classifyPosition("Chief Revenue Officer"), "c_level_business");
  assert.equal(classifyPosition("CTO and Revenue Manager"), "c_level_tech");
  assert.equal(classifyPosition("VP Revenue Management"), "eng_leadership");
  assert.equal(classifyPosition("Revenue Systems Engineer"), "developers");
  assert.equal(classifyPosition("Revenue Manager and Recruiter"), "hr_recruiting");
});

test("the new rule never routes into a hidden group", () => {
  for (const t of [...REAL_REVENUE_TITLES, ...FUTURE_TITLES]) {
    assert.ok(!["developers", "sales_bd"].includes(classifyPosition(t)), t);
  }
});

test("registration: display order, playbook, leadership/IT exclusion", () => {
  const keys = ROLE_GROUPS.map((g) => g.key);
  assert.equal(keys.indexOf("hospitality_revenue"), keys.indexOf("sales_bd") - 1);
  assert.equal(ROLE_GROUP_PLAYBOOK.hospitality_revenue.priority, "media");
  const hidden = Object.values(NOT_WORTH_PRIORITIZING).flatMap((t) => t.keys);
  assert.ok(!hidden.includes("hospitality_revenue"));
  assert.ok(!LEADERSHIP_ROLE_GROUPS.includes("hospitality_revenue"));
  assert.ok(!(IT_ROLE_GROUPS as readonly string[]).includes("hospitality_revenue"));
});
