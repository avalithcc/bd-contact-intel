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
  InvalidPhoneError,
  isEditablePersonProperty,
  planLocationEdit,
  planPropertyEdit,
  planPropertyEditBatch,
  PropertyBatchEditError,
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
  phone: "+54 11 4000-0000",
  mobilePhone: null,
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

// --- phone/mobilePhone (migration 0016) -------------------------------------

test("phone and mobilePhone are editable properties", () => {
  assert.equal(isEditablePersonProperty("phone"), true);
  assert.equal(isEditablePersonProperty("mobilePhone"), true);
});

test("a valid phone edit produces a plain personUpdate/history row, no derived columns", () => {
  const plan = planPropertyEdit(BASE_PERSON, "mobilePhone", "+54 9 11 4123-4567", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.mobilePhone, "+54 9 11 4123-4567");
  assert.deepEqual(plan.historyRows, [
    {
      personId: BASE_PERSON.id,
      property: "mobilePhone",
      oldValue: null,
      newValue: "+54 9 11 4123-4567",
      changedByBdId: "bd-1",
      source: "edit",
    },
  ]);
});

test("clearing a phone property is always allowed (no format check on blank)", () => {
  const plan = planPropertyEdit(BASE_PERSON, "phone", "   ", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.phone, null);
});

test("an invalid phone format is rejected before any plan is built", () => {
  assert.throws(
    () => planPropertyEdit(BASE_PERSON, "phone", "call me maybe", "bd-1"),
    InvalidPhoneError,
  );
  assert.throws(
    () => planPropertyEdit(BASE_PERSON, "mobilePhone", "123", "bd-1"),
    InvalidPhoneError,
  );
});

// --- planPropertyEditBatch / planLocationEdit (fresh-review CRITICAL fix:
// LocationPropertyRow used to call updateContactPropertyAction three times
// sequentially, so a rejected second/third field left the first one already
// persisted) ------------------------------------------------------------

test("batch: all-or-nothing — a rejected entry throws before any entry is merged into a plan", () => {
  // jobTitle would be accepted on its own, but it comes BEFORE the rejected
  // "email" entry; the whole batch must still throw with nothing returned,
  // proving the accepted jobTitle change was never exposed to a caller.
  assert.throws(
    () =>
      planPropertyEditBatch(
        BASE_PERSON,
        [
          { property: "jobTitle", rawNewValue: "VP of Engineering" },
          { property: "email", rawNewValue: "not-an-email" },
        ],
        "bd-1",
      ),
    (err: unknown) => {
      assert.ok(err instanceof PropertyBatchEditError);
      assert.equal(err.property, "email");
      assert.ok(err.cause instanceof InvalidEmailError);
      return true;
    },
  );
});

test("batch: only entries whose value actually changed are written", () => {
  const plan = planPropertyEditBatch(
    BASE_PERSON,
    [
      { property: "jobTitle", rawNewValue: "VP of Engineering" },
      { property: "roleGroup", rawNewValue: "   " }, // null -> null, a no-op
    ],
    "bd-1",
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.jobTitle, "VP of Engineering");
  assert.equal("roleGroup" in (plan.personUpdate ?? {}), false);
  assert.deepEqual(
    plan.historyRows.map((r) => r.property),
    ["jobTitle"],
  );
});

test("batch: one history row per changed field (plus email's derived columns), merged from every entry", () => {
  const plan = planPropertyEditBatch(
    BASE_PERSON,
    [
      { property: "jobTitle", rawNewValue: "VP of Engineering" },
      { property: "email", rawNewValue: "new.person@example.com" },
    ],
    "bd-1",
  );
  assert.equal(plan.changed, true);
  assert.deepEqual(
    plan.historyRows.map((r) => r.property).sort(),
    ["email", "emailNormalized", "emailSource", "emailStatus", "jobTitle"],
  );
});

test("batch planner never mutates its inputs — calling it twice with the same input gives the same result", () => {
  const person = { ...BASE_PERSON };
  const entries = [
    { property: "jobTitle" as const, rawNewValue: "VP of Engineering" },
    { property: "city" as const, rawNewValue: "Buenos Aires" },
  ];
  const entriesSnapshot = JSON.parse(JSON.stringify(entries));
  const personSnapshot = JSON.parse(JSON.stringify(person));

  const first = planPropertyEditBatch(person, entries, "bd-1");
  const second = planPropertyEditBatch(person, entries, "bd-1");

  assert.deepEqual(JSON.parse(JSON.stringify(entries)), entriesSnapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(person)), personSnapshot);
  assert.equal(first.personUpdate?.jobTitle, second.personUpdate?.jobTitle);
  assert.equal(first.personUpdate?.city, second.personUpdate?.city);
  assert.deepEqual(
    first.historyRows.map(({ ...r }) => r),
    second.historyRows.map(({ ...r }) => r),
  );
});

test("planLocationEdit: no field changed reports changed: false", () => {
  const plan = planLocationEdit(BASE_PERSON, { city: "", region: "", country: "" }, "bd-1");
  assert.deepEqual(plan, { changed: false, personUpdate: null, historyRows: [] });
});

test("planLocationEdit: only the changed location field gets a person update and a history row", () => {
  const plan = planLocationEdit(BASE_PERSON, { city: "Buenos Aires", region: "", country: "" }, "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.city, "Buenos Aires");
  assert.equal("region" in (plan.personUpdate ?? {}), false);
  assert.equal("country" in (plan.personUpdate ?? {}), false);
  assert.deepEqual(plan.historyRows, [
    {
      personId: BASE_PERSON.id,
      property: "city",
      oldValue: null,
      newValue: "Buenos Aires",
      changedByBdId: "bd-1",
      source: "edit",
    },
  ]);
});

test("planLocationEdit: all three changed fields each get their own history row", () => {
  const plan = planLocationEdit(
    BASE_PERSON,
    { city: "Buenos Aires", region: "CABA", country: "Argentina" },
    "bd-1",
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.city, "Buenos Aires");
  assert.equal(plan.personUpdate?.region, "CABA");
  assert.equal(plan.personUpdate?.country, "Argentina");
  assert.deepEqual(
    plan.historyRows.map((r) => r.property).sort(),
    ["city", "country", "region"],
  );
});
