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
  isEditablePersonProperty,
  planPropertyEdit,
} from "@/lib/contacts/propertyEdit";

const BASE_PERSON = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "old@example.com",
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

test("no-op edit (same trimmed value) reports changed: false", () => {
  const plan = planPropertyEdit(BASE_PERSON, "email", "  old@example.com  ", "bd-1");
  assert.deepEqual(plan, { changed: false, personUpdate: null, historyRow: null });
});

test("changed value produces a person update and a history row", () => {
  const plan = planPropertyEdit(BASE_PERSON, "jobTitle", "VP of Engineering", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.jobTitle, "VP of Engineering");
  assert.equal(plan.personUpdate?.updatedByBdId, "bd-1");
  assert.ok(plan.personUpdate?.updatedAt instanceof Date);
  assert.deepEqual(plan.historyRow, {
    personId: BASE_PERSON.id,
    property: "jobTitle",
    oldValue: "Engineer",
    newValue: "VP of Engineering",
    changedByBdId: "bd-1",
    source: "edit",
  });
});

test("blank new value clears the property to null", () => {
  const plan = planPropertyEdit(BASE_PERSON, "email", "   ", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.email, null);
  assert.equal(plan.historyRow?.newValue, null);
  assert.equal(plan.historyRow?.oldValue, "old@example.com");
});

test("null -> null (both empty) reports changed: false", () => {
  const plan = planPropertyEdit(BASE_PERSON, "roleGroup", "   ", "bd-1");
  assert.deepEqual(plan, { changed: false, personUpdate: null, historyRow: null });
});
