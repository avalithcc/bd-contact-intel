/**
 * Unit tests for src/lib/contacts/propertyEdit.ts — the pure planner for a
 * single-property inline edit on the Contact record page (contact-record
 * spec "editable properties"; contact-identity R7 "one current value per
 * property with change history recording who last updated it"). No DB: the
 * thin glue (propertyEditDb.ts) reads the current person row, calls this,
 * and writes both the person update and the history row in one transaction.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EDITABLE_PERSON_PROPERTIES,
  InvalidEmailError,
  isEditablePersonProperty,
  planPropertyEdit,
} from "@/lib/contacts/propertyEdit";

const BASE_PERSON = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "old@example.com",
  emailNormalized: "old@example.com",
  emailStatus: "verified",
  emailSource: "fi-arg-2026-mails-hunter",
  jobTitle: "Engineer",
  roleGroup: null,
  seniority: null,
  city: null,
  region: null,
  country: null,
  industry: null,
};

test("isEditablePersonProperty accepts only the allow-listed columns", () => {
  for (const prop of EDITABLE_PERSON_PROPERTIES) {
    assert.equal(isEditablePersonProperty(prop), true);
  }
  assert.equal(isEditablePersonProperty("status"), false);
  assert.equal(isEditablePersonProperty("ownerBdId"), false);
  assert.equal(isEditablePersonProperty("mergedIntoId"), false);
});

test("changed value produces a person update and a history row", () => {
  const plan = planPropertyEdit(BASE_PERSON, "jobTitle", "VP of Engineering", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.jobTitle, "VP of Engineering");
  assert.equal(plan.personUpdate?.updatedByBdId, "bd-1");
  assert.ok(plan.personUpdate?.updatedAt instanceof Date);
  assert.deepEqual(plan.historyRows, [
    {
      personId: BASE_PERSON.id,
      property: "jobTitle",
      oldValue: "Engineer",
      newValue: "VP of Engineering",
      changedByBdId: "bd-1",
      source: "edit",
    },
  ]);
});

test("null -> null (both empty) reports changed: false", () => {
  const plan = planPropertyEdit(BASE_PERSON, "roleGroup", "   ", "bd-1");
  assert.deepEqual(plan, { changed: false, personUpdate: null, historyRows: [] });
});

// --- email-specific behavior (fresh-review CRITICAL fix) -------------------

test("valid email edit also updates emailNormalized, emailStatus and emailSource, with a history row per changed column", () => {
  const plan = planPropertyEdit(BASE_PERSON, "email", "  New.Person@Example.com  ", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.email, "New.Person@Example.com");
  assert.equal(plan.personUpdate?.emailNormalized, "new.person@example.com");
  assert.equal(plan.personUpdate?.emailStatus, "none");
  assert.equal(plan.personUpdate?.emailSource, "manual");
  assert.deepEqual(
    plan.historyRows.map((r) => r.property).sort(),
    ["email", "emailNormalized", "emailSource", "emailStatus"],
  );
  const byProperty = Object.fromEntries(plan.historyRows.map((r) => [r.property, r]));
  assert.equal(byProperty.email.oldValue, "old@example.com");
  assert.equal(byProperty.email.newValue, "New.Person@Example.com");
  assert.equal(byProperty.emailNormalized.oldValue, "old@example.com");
  assert.equal(byProperty.emailNormalized.newValue, "new.person@example.com");
  assert.equal(byProperty.emailStatus.oldValue, "verified");
  assert.equal(byProperty.emailStatus.newValue, "none");
  assert.equal(byProperty.emailSource.oldValue, "fi-arg-2026-mails-hunter");
  assert.equal(byProperty.emailSource.newValue, "manual");
});

test("clearing email nulls out email, emailNormalized and emailSource, and resets emailStatus to none", () => {
  const plan = planPropertyEdit(BASE_PERSON, "email", "   ", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.email, null);
  assert.equal(plan.personUpdate?.emailNormalized, null);
  assert.equal(plan.personUpdate?.emailStatus, "none");
  assert.equal(plan.personUpdate?.emailSource, null);
  const byProperty = Object.fromEntries(plan.historyRows.map((r) => [r.property, r]));
  assert.equal(byProperty.email.newValue, null);
  assert.equal(byProperty.emailNormalized.newValue, null);
  assert.equal(byProperty.emailSource.newValue, null);
});

test("invalid email format is rejected before any plan is built", () => {
  assert.throws(
    () => planPropertyEdit(BASE_PERSON, "email", "not-an-email", "bd-1"),
    InvalidEmailError,
  );
});

test("no-op email edit (same trimmed value) reports changed: false and does not re-validate format", () => {
  const plan = planPropertyEdit(BASE_PERSON, "email", " old@example.com ", "bd-1");
  assert.deepEqual(plan, { changed: false, personUpdate: null, historyRows: [] });
});
