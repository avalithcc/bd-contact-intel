/**
 * Unit tests for src/lib/contacts/filterFieldKinds.ts — which control type
 * FilterMenu.tsx renders for each "Agregar filtro" field (mockups/
 * contacts.html: picking a menu item opens that filter's own inline
 * editor). Pure config only — no DOM, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXTRA_FILTER_MENU_ORDER, FILTER_FIELD_KIND, FILTER_MENU_ORDER } from "@/lib/contacts/filterFieldKinds";

test("FILTER_MENU_ORDER lists exactly the mockup's 12 'Agregar filtro' options (migration 0016 added 'Tiene teléfono', contact-type-ui added 'Tipo de contacto'), in menu order", () => {
  assert.deepEqual(FILTER_MENU_ORDER, [
    "owner",
    "status",
    "emailStatus",
    "hasPhone",
    "company",
    "hiring",
    "market",
    "roleGroup",
    "contactType",
    "startupsOnly",
    "bdConnected",
    "lastActivityDays",
  ]);
});

test("FILTER_FIELD_KIND assigns the right control type to each of the 11 mockup filters", () => {
  assert.equal(FILTER_FIELD_KIND.owner, "select");
  assert.equal(FILTER_FIELD_KIND.status, "multiselect");
  assert.equal(FILTER_FIELD_KIND.emailStatus, "select");
  assert.equal(FILTER_FIELD_KIND.hasPhone, "checkbox");
  assert.equal(FILTER_FIELD_KIND.company, "text");
  assert.equal(FILTER_FIELD_KIND.hiring, "checkbox");
  assert.equal(FILTER_FIELD_KIND.market, "select");
  assert.equal(FILTER_FIELD_KIND.roleGroup, "select");
  assert.equal(FILTER_FIELD_KIND.startupsOnly, "checkbox");
  assert.equal(FILTER_FIELD_KIND.bdConnected, "select");
  assert.equal(FILTER_FIELD_KIND.lastActivityDays, "select");
});

test("every field in FILTER_MENU_ORDER has a FILTER_FIELD_KIND entry", () => {
  for (const field of FILTER_MENU_ORDER) {
    assert.ok(FILTER_FIELD_KIND[field], `missing kind for ${field}`);
  }
});

test("EXTRA_FILTER_MENU_ORDER covers the pre-existing industryGroup/seniority filters (not in the mockup's 10, but not silently dropped either)", () => {
  assert.deepEqual(EXTRA_FILTER_MENU_ORDER, ["industryGroup", "seniority"]);
  for (const field of EXTRA_FILTER_MENU_ORDER) {
    assert.ok(FILTER_FIELD_KIND[field], `missing kind for ${field}`);
  }
});
