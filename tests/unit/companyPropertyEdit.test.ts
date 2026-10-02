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
  InvalidClientStatusError,
  InvalidOwnerError,
  isEditableCompanyProperty,
  planCompanyPropertyEdit,
} from "@/lib/companies/propertyEdit";
import { InvalidCompanyLinkedinUrlError } from "@/lib/companies/linkedinUrl";

const BD_1 = "11111111-1111-1111-1111-111111111111";
const BD_2 = "22222222-2222-2222-2222-222222222222";

const BASE_COMPANY = {
  companyKey: "acme",
  industry: "Software",
  ownerBdId: null,
  city: null,
  country: null,
  clientStatus: null,
  linkedinUrl: null,
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
    clientStatus: null,
    linkedinUrl: null,
  });
});

test("clientStatus is an editable property", () => {
  assert.equal(isEditableCompanyProperty("clientStatus"), true);
});

test("planCompanyPropertyEdit sets clientStatus and writes a history row", () => {
  const plan = planCompanyPropertyEdit(BASE_COMPANY, "clientStatus", " inactive ", BD_1);
  assert.equal(plan.changed, true);
  assert.equal(plan.companyUpdate!.clientStatus, "inactive");
  assert.deepEqual(plan.historyRows, [
    {
      companyKey: "acme",
      property: "clientStatus",
      oldValue: null,
      newValue: "inactive",
      changedByBdId: BD_1,
      source: "edit",
    },
  ]);
});

test("planCompanyPropertyEdit moves clientStatus between active and inactive with old and new in history", () => {
  const plan = planCompanyPropertyEdit({ ...BASE_COMPANY, clientStatus: "active" }, "clientStatus", "inactive", BD_2);
  assert.equal(plan.historyRows[0]!.oldValue, "active");
  assert.equal(plan.historyRows[0]!.newValue, "inactive");
  assert.equal(plan.historyRows[0]!.changedByBdId, BD_2);
});

test("planCompanyPropertyEdit clears clientStatus to null on a blank value (not a client)", () => {
  const plan = planCompanyPropertyEdit({ ...BASE_COMPANY, clientStatus: "active" }, "clientStatus", "", BD_1);
  assert.equal(plan.changed, true);
  assert.equal(plan.companyUpdate!.clientStatus, null);
  assert.equal(plan.historyRows[0]!.newValue, null);
});

test("planCompanyPropertyEdit reports no change when clientStatus is already that value", () => {
  const plan = planCompanyPropertyEdit({ ...BASE_COMPANY, clientStatus: "active" }, "clientStatus", "active", BD_1);
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.historyRows, []);
});

test("planCompanyPropertyEdit rejects a clientStatus outside the vocabulary before building a plan", () => {
  assert.throws(
    () => planCompanyPropertyEdit(BASE_COMPANY, "clientStatus", "dormant", BD_1),
    InvalidClientStatusError,
  );
  assert.throws(
    () => planCompanyPropertyEdit(BASE_COMPANY, "clientStatus", "Active", BD_1),
    InvalidClientStatusError,
  );
});

test("clientStatus edit never touches accountType or relationshipStage", () => {
  const plan = planCompanyPropertyEdit(BASE_COMPANY, "clientStatus", "active", BD_1);
  assert.deepEqual(Object.keys(plan.companyUpdate!).sort(), ["clientStatus", "updatedAt", "updatedByBdId"]);
});

test("planCompanyPropertyEdit does not mutate its input and is repeatable", () => {
  const input = { ...BASE_COMPANY, clientStatus: "active" };
  const snapshot = structuredClone(input);
  const a = planCompanyPropertyEdit(input, "clientStatus", "inactive", BD_1);
  const b = planCompanyPropertyEdit(input, "clientStatus", "inactive", BD_1);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(a.historyRows, b.historyRows);
  assert.equal(a.companyUpdate!.clientStatus, b.companyUpdate!.clientStatus);
});

test("linkedinUrl is an editable property", () => {
  assert.equal(isEditableCompanyProperty("linkedinUrl"), true);
});

test("planCompanyPropertyEdit stores the normalised LinkedIn URL and writes one history row", () => {
  const plan = planCompanyPropertyEdit(
    BASE_COMPANY,
    "linkedinUrl",
    " https://www.linkedin.com/company/Avalith/?originalSubdomain=ar ",
    BD_1,
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.companyUpdate!.linkedinUrl, "linkedin.com/company/avalith");
  assert.deepEqual(plan.historyRows, [
    {
      companyKey: "acme",
      property: "linkedinUrl",
      oldValue: null,
      newValue: "linkedin.com/company/avalith",
      changedByBdId: BD_1,
      source: "edit",
    },
  ]);
});

test("planCompanyPropertyEdit reports no change when the pasted URL normalises to the stored one", () => {
  const stored = { ...BASE_COMPANY, linkedinUrl: "linkedin.com/company/avalith" };
  const plan = planCompanyPropertyEdit(stored, "linkedinUrl", "https://www.linkedin.com/company/avalith/", BD_1);
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.historyRows, []);
});

test("planCompanyPropertyEdit clears linkedinUrl to null on a blank value", () => {
  const stored = { ...BASE_COMPANY, linkedinUrl: "linkedin.com/company/avalith" };
  const plan = planCompanyPropertyEdit(stored, "linkedinUrl", "   ", BD_1);
  assert.equal(plan.changed, true);
  assert.equal(plan.companyUpdate!.linkedinUrl, null);
  assert.equal(plan.historyRows[0]!.oldValue, "linkedin.com/company/avalith");
  assert.equal(plan.historyRows[0]!.newValue, null);
});

test("planCompanyPropertyEdit rejects a personal profile and a foreign host before building a plan", () => {
  assert.throws(
    () => planCompanyPropertyEdit(BASE_COMPANY, "linkedinUrl", "https://www.linkedin.com/in/john-doe", BD_1),
    (e: unknown) => e instanceof InvalidCompanyLinkedinUrlError && e.reason === "personal_profile",
  );
  assert.throws(
    () => planCompanyPropertyEdit(BASE_COMPANY, "linkedinUrl", "https://avalith.net", BD_1),
    (e: unknown) => e instanceof InvalidCompanyLinkedinUrlError && e.reason === "not_linkedin",
  );
});

test("linkedinUrl edit touches only linkedinUrl and the audit columns", () => {
  const plan = planCompanyPropertyEdit(BASE_COMPANY, "linkedinUrl", "avalith", BD_1);
  assert.deepEqual(Object.keys(plan.companyUpdate!).sort(), ["linkedinUrl", "updatedAt", "updatedByBdId"]);
});

test("linkedinUrl planning does not mutate its input and is repeatable", () => {
  const input = { ...BASE_COMPANY, linkedinUrl: "linkedin.com/company/old" };
  const snapshot = structuredClone(input);
  const a = planCompanyPropertyEdit(input, "linkedinUrl", "linkedin.com/company/new/", BD_1);
  const b = planCompanyPropertyEdit(input, "linkedinUrl", "linkedin.com/company/new/", BD_1);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(a.historyRows, b.historyRows);
  assert.equal(a.companyUpdate!.linkedinUrl, b.companyUpdate!.linkedinUrl);
});
