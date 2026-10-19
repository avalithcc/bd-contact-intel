/**
 * German (and bare "Direktor") general-management titles on the hotel
 * contacts. The Spanish and Italian terms already classify; these were the
 * remaining gap from the hotel-role-groups backlog item.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyPosition } from "../../src/lib/roleGroups";

test("German general-management titles classify as c_level_business", () => {
  for (const t of [
    "Geschäftsführer",
    "Geschaeftsfuehrer",
    "Geschäftsführerin",
    "Geschäftsführer Hotel Alpenblick",
    "Hoteldirektor",
    "Hoteldirektorin",
    "Generaldirektor",
    "Direktor",
    "direktor",
    "Hotelmanager",
  ]) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
});

test("bare Direktor is whole-title only: qualified forms keep their group", () => {
  assert.equal(classifyPosition("Direktor Vertrieb"), "other");
  assert.equal(classifyPosition("Sales Direktor"), "sales_bd");
  assert.equal(classifyPosition("Technical Director"), "eng_leadership");
});

test("already-covered Spanish and Italian terms and existing groups are unchanged", () => {
  for (const t of ["Director General", "Gerente General", "Consejero delegado", "Direttore", "Direttore Generale", "Proprietario", "General Manager", "Inhaber"]) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
  assert.equal(classifyPosition("CTO"), "c_level_tech");
  assert.equal(classifyPosition("Software Engineer"), "developers");
  assert.equal(classifyPosition("Revenue Manager"), "hospitality_revenue");
  assert.equal(classifyPosition("Direttore commerciale"), "other");
});

test("assistants and secretaries to a Geschäftsführer or Hoteldirektor are not general management", () => {
  for (const t of [
    "Assistent des Geschäftsführers",
    "Assistentin der Geschäftsführung",
    "Assistant to the Geschäftsführer",
    "Assistenz der Geschäftsführer",
    "Sekretärin des Hoteldirektors",
    "Sekretaer Geschäftsführer",
    "Office Manager Geschäftsführer",
    "Assistent des Generaldirektors",
  ]) {
    assert.notEqual(classifyPosition(t), "c_level_business", t);
  }
});

test("the German suffix is gender endings only, with a word boundary", () => {
  for (const t of ["Geschäftsführerin", "Geschäftsführerinnen", "Hoteldirektorin", "Geschäftsführer/in", "Geschäftsführer, Hotel Alpenblick"]) {
    assert.equal(classifyPosition(t), "c_level_business", t);
  }
  for (const t of ["Geschäftsführers", "Geschäftsführerassistent", "Hoteldirektoren Assistent"]) {
    assert.notEqual(classifyPosition(t), "c_level_business", t);
  }
});

test("bare Direktorin is whole-title only, like Direktor", () => {
  assert.equal(classifyPosition("Direktorin"), "c_level_business");
  assert.equal(classifyPosition("Direktorin Einkauf"), "other");
});
