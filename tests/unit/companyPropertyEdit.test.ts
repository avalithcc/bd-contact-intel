/**
 * Unit tests for src/lib/companies/propertyEdit.ts — the pure planner for a
 * single-property inline edit on the Company record page (company-fields
 * change), mirroring src/lib/contacts/propertyEdit.ts. No DB: the thin glue
 * (propertyEditDb.ts) reads the current company row, calls this, and writes
 * both the company update and the company_property_history row in one
 * transaction.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EDITABLE_COMPANY_PROPERTIES,
  InvalidOwnerError,
  isEditableCompanyProperty,
  planCompanyPropertyEdit,
} from "@/lib/companies/propertyEdit";

const BD_1 = "11111111-1111-1111-1111-111111111111";
const BD_2 = "22222222-2222-2222-2222-222222222222";

const BASE_COMPANY = {
  companyKey: "acme",
  industry: "Software",
  ownerBdId: null,
  city: null,
  country: null,
};

test("isEditableCompanyProperty accepts only the allow-listed columns", () => {
  for (const prop of EDITABLE_COMPANY_PROPERTIES) {
    assert.equal(isEditableCompanyProperty(prop), true);
  }
  assert.equal(isEditableCompanyProperty("companyKey"), false);
  assert.equal(isEditableCompanyProperty("relationshipStage"), false);
});

test("planCompanyPropertyEdit reports changed: false for a no-op edit", () => {
  const plan = planCompanyPropertyEdit(BASE_COMPANY, "industry", "Software", BD_1);
  assert.equal(plan.changed, false);
  assert.equal(plan.companyUpdate, null);
  assert.deepEqual(plan.historyRows, []);
});

test("planCompanyPropertyEdit clears a property to null on a blank value", () => {
  const plan = planCompanyPropertyEdit(BASE_COMPANY, "industry", "   ", BD_1);
  assert.equal(plan.changed, true);
  assert.equal(plan.companyUpdate!.industry, null);
  assert.deepEqual(plan.historyRows, [
    {
      companyKey: "acme",
      property: "industry",
      oldValue: "Software",
      newValue: null,
      changedByBdId: BD_1,
      source: "edit",
    },
  ]);
});

test("planCompanyPropertyEdit trims and writes a plain text property", () => {
  const plan = planCompanyPropertyEdit(BASE_COMPANY, "city", "  Buenos Aires  ", BD_1);
  assert.equal(plan.changed, true);
  assert.equal(plan.companyUpdate!.city, "Buenos Aires");
  assert.equal(plan.companyUpdate!.updatedByBdId, BD_1);
  assert.ok(plan.companyUpdate!.updatedAt instanceof Date);
  assert.deepEqual(plan.historyRows, [
    {
      companyKey: "acme",
      property: "city",
      oldValue: null,
      newValue: "Buenos Aires",
      changedByBdId: BD_1,
      source: "edit",
    },
  ]);
});

test("planCompanyPropertyEdit sets ownerBdId when the caller confirms it's a real BD", () => {
  const plan = planCompanyPropertyEdit(BASE_COMPANY, "ownerBdId", BD_2, BD_1, { ownerExists: true });
  assert.equal(plan.changed, true);
  assert.equal(plan.companyUpdate!.ownerBdId, BD_2);
  assert.deepEqual(plan.historyRows, [
    {
      companyKey: "acme",
      property: "ownerBdId",
      oldValue: null,
      newValue: BD_2,
      changedByBdId: BD_1,
      source: "edit",
    },
  ]);
});

test("planCompanyPropertyEdit throws InvalidOwnerError when the id is not a real BD", () => {
  assert.throws(
    () => planCompanyPropertyEdit(BASE_COMPANY, "ownerBdId", BD_2, BD_1, { ownerExists: false }),
    InvalidOwnerError,
  );
});

test("planCompanyPropertyEdit clearing ownerBdId never requires ownerExists", () => {
  const owned = { ...BASE_COMPANY, ownerBdId: BD_2 };
  const plan = planCompanyPropertyEdit(owned, "ownerBdId", "", BD_1);
  assert.equal(plan.changed, true);
  assert.equal(plan.companyUpdate!.ownerBdId, null);
});

test("planCompanyPropertyEdit is a pure function: same input twice yields the same result", () => {
  const first = planCompanyPropertyEdit(BASE_COMPANY, "city", "Rosario", BD_1);
  const second = planCompanyPropertyEdit(BASE_COMPANY, "city", "Rosario", BD_1);
  assert.deepEqual(first.companyUpdate!.city, second.companyUpdate!.city);
  assert.deepEqual(BASE_COMPANY, {
    companyKey: "acme",
    industry: "Software",
    ownerBdId: null,
    city: null,
    country: null,
  });
});
