/**
 * General-management / ownership / board vocabulary (Spanish, Italian,
 * German) in classifyPosition. Source of the terms: the title groups listed in
 * openspec/changes/hoteles-data-quality/README.md section 2.
 *
 * Hard safety rule: none of these titles may land in `developers` or
 * `sales_bd`, the two groups the default contacts view hides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyPosition } from "../../src/lib/roleGroups";

const GENERAL_MANAGEMENT_TITLES = [
  "Director General",
  "Directora General",
  "Director general adjunto",
  "Consejero delegado",
  "Consejera Delegada",
  "Director de Hotel",
  "Directora de Hotel",
  "Hotel Manager",
  "Direttore",
  "Direttore Generale",
  "Direttrice Generale",
  "Proprietario",
  "Proprietaria",
  "Unternehmensinhaber",
  "Unternehmensinhaberin",
  "Inhaber",
  "Amministratore",
  "Amministratore Delegato",
  "Amministratore Unico",
  "Membro del Consiglio di Amministrazione",
  "Miembro del Consejo de Administración",
];

const HIDDEN_BY_DEFAULT = ["developers", "sales_bd"];

test("general-management titles classify as c_level_business", () => {
  for (const title of GENERAL_MANAGEMENT_TITLES) {
    assert.equal(classifyPosition(title), "c_level_business", title);
  }
});

test("no added title can route anyone into a group the default view hides", () => {
  for (const title of GENERAL_MANAGEMENT_TITLES) {
    assert.ok(!HIDDEN_BY_DEFAULT.includes(classifyPosition(title)), title);
  }
});

test("bare words stay narrow: a qualified title is not swept into c_level_business", () => {
  assert.equal(classifyPosition("Direttore Commerciale"), "other");
  assert.equal(classifyPosition("Amministratore di sistema"), "other");
  assert.equal(classifyPosition("Direttore Vendite"), "other");
});

test("out-of-scope hotel titles are still left in other", () => {
  for (const title of [
    "Revenue Manager",
    "Director of Revenue Management",
    "Reservations Manager",
    "Director financiero",
    "Guest Relations Specialist",
    "Vocal",
    "Professor CFGS",
  ]) {
    assert.equal(classifyPosition(title), "other", title);
  }
});

test("existing general-management terms are unchanged", () => {
  assert.equal(classifyPosition("General Manager"), "c_level_business");
  assert.equal(classifyPosition("Gerente General"), "c_level_business");
});
