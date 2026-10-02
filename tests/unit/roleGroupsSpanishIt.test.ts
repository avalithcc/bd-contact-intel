/**
 * "TI" (tecnologias de la informacion), the Spanish abbreviation of "IT",
 * in eng_leadership. Same bug class as the Spanish/Italian/German management
 * vocabulary: "Gerente de TI" / "Director de TI" sat unclassified in `other`.
 *
 * Decision: `ti` is added ONLY inside the leadership-title patterns
 * ("director|gerente|jefe [de] ti"), never as a bare standalone term. A bare
 * `ti` would capture the Spanish pronoun / Italian word / company and surname
 * tokens ("Ti Group", "Ti Nguyen") in any title.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyPosition } from "../../src/lib/roleGroups";

test("Spanish IT leadership titles classify as eng_leadership", () => {
  for (const t of [
    "Gerente de TI",
    "Gerente TI",
    "Director de TI",
    "Directora de TI",
    "Director TI",
    "Director, TI",
    "Jefe de TI",
    "Jefa de TI",
    "Director de ti",
  ]) {
    assert.equal(classifyPosition(t), "eng_leadership", t);
  }
});

test("bare 'ti' is not a term: pronoun and company/surname tokens stay out", () => {
  assert.equal(classifyPosition("Director de Compras en Ti Group"), "other");
  assert.equal(classifyPosition("Cerca de ti"), "other");
  assert.equal(classifyPosition("Ti Nguyen"), "other");
  assert.equal(classifyPosition("Analista de TI"), "other");
});

test("the TI term does not route anyone into a hidden group", () => {
  for (const t of ["Gerente de TI", "Director de TI", "Jefe de TI"]) {
    assert.ok(!["developers", "sales_bd"].includes(classifyPosition(t)), t);
  }
});

test("existing IT leadership terms are unchanged", () => {
  assert.equal(classifyPosition("Gerente de IT"), "eng_leadership");
  assert.equal(classifyPosition("Director of IT"), "eng_leadership");
  assert.equal(classifyPosition("Jefe de Sistemas"), "eng_leadership");
});

test("real mixed titles move into eng_leadership (from operations / project_delivery)", () => {
  assert.equal(classifyPosition("Gerente TI & Operaciones"), "eng_leadership");
  assert.equal(
    classifyPosition("GERENTE DE PROYECTOS SAP, JEFE DE TI - JEFE DE PROYECTOS SAP - TRANSFORMACIÓN DIGITAL"),
    "eng_leadership",
  );
});

test("accepted limitation: a surname 'Ti' after a leadership word matches", () => {
  // `ti` is a word-boundary term, so "Director Ti Nguyen" reads as "Director TI".
  // Documented, not a silent bug: production has zero such rows (measured).
  assert.equal(classifyPosition("Director Ti Nguyen"), "eng_leadership");
});
