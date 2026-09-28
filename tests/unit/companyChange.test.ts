/**
 * Unit tests for src/lib/contacts/companyChange.ts — the pure planner
 * behind the "Cambiar empresa" dialog on the Contact record page. No DB:
 * the thin glue (companyChangeDb.ts) reads the current person row and the
 * picked company row, calls this, and writes both the person update and
 * the history rows in one transaction so they never diverge (same
 * convention as propertyEdit.ts/propertyEditDb.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planCompanyChange } from "@/lib/contacts/companyChange";

const BASE_PERSON = {
  id: "11111111-1111-1111-1111-111111111111",
  company: null as string | null,
  companyKey: null as string | null,
};

test("picking the same company the contact already has is a no-op", () => {
  const person = { ...BASE_PERSON, company: "Kavak", companyKey: "kavak" };
  const plan = planCompanyChange(person, { companyKey: "kavak", displayName: "Kavak" }, "bd-1");
  assert.equal(plan.changed, false);
  assert.equal(plan.personUpdate, null);
  assert.deepEqual(plan.historyRows, []);
});

test("attaching a company for the first time sets company+companyKey and writes both history rows", () => {
  const plan = planCompanyChange(BASE_PERSON, { companyKey: "mercado-libre", displayName: "Mercado Libre" }, "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.company, "Mercado Libre");
  assert.equal(plan.personUpdate?.companyKey, "mercado-libre");
  assert.equal(plan.personUpdate?.updatedByBdId, "bd-1");
  assert.deepEqual(
    plan.historyRows.map((r) => [r.property, r.oldValue, r.newValue]),
    [
      ["company", null, "Mercado Libre"],
      ["companyKey", null, "mercado-libre"],
    ],
  );
});

test("switching to a different company records the old and new values for both fields", () => {
  const person = { ...BASE_PERSON, company: "Globant SA", companyKey: "globant" };
  const plan = planCompanyChange(person, { companyKey: "mercado-libre", displayName: "Mercado Libre" }, "bd-1");
  assert.equal(plan.changed, true);
  assert.deepEqual(
    plan.historyRows.map((r) => [r.property, r.oldValue, r.newValue]),
    [
      ["company", "Globant SA", "Mercado Libre"],
      ["companyKey", "globant", "mercado-libre"],
    ],
  );
});

test("detaching (newCompany null) clears both company and companyKey", () => {
  const person = { ...BASE_PERSON, company: "Kavak", companyKey: "kavak" };
  const plan = planCompanyChange(person, null, "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.company, null);
  assert.equal(plan.personUpdate?.companyKey, null);
  assert.deepEqual(
    plan.historyRows.map((r) => [r.property, r.oldValue, r.newValue]),
    [
      ["company", "Kavak", null],
      ["companyKey", "kavak", null],
    ],
  );
});

test("detaching an already-blank company is a no-op", () => {
  const plan = planCompanyChange(BASE_PERSON, null, "bd-1");
  assert.equal(plan.changed, false);
  assert.equal(plan.personUpdate, null);
  assert.deepEqual(plan.historyRows, []);
});

test("only the field that actually changed gets a history row", () => {
  // Defensive case: the display name on file drifted from the company's
  // canonical name (e.g. an older "Globant SA" import) but the key already
  // matches the picked company — only `company` should get a history row.
  const person = { ...BASE_PERSON, company: "Globant SA", companyKey: "globant" };
  const plan = planCompanyChange(person, { companyKey: "globant", displayName: "Globant" }, "bd-1");
  assert.equal(plan.changed, true);
  assert.deepEqual(
    plan.historyRows.map((r) => [r.property, r.oldValue, r.newValue]),
    [["company", "Globant SA", "Globant"]],
  );
});
