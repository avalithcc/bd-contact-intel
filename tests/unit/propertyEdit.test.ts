/**
 * Unit tests for src/lib/contacts/propertyEdit.ts — the pure planner for a
 * single-property inline edit on the Contact record page (contact-record
 * spec "editable properties"; contact-identity R7 "one current value per
 * property with change history recording who last updated it"). No DB: the
 * thin glue (propertyEditDb.ts) reads the current person row, calls this,
 * and writes both the person update and the history row in one transaction.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizePhoneForWrite } from "@/lib/phoneNormalize";
import {
  EDITABLE_PERSON_PROPERTIES,
  InvalidContactTypeError,
  InvalidPreferredLanguageError,
  InvalidEmailError,
  InvalidNameError,
  InvalidPhoneError,
  InvalidProfileKeyError,
  isEditablePersonProperty,
  planLocationEdit,
  planPropertyEdit,
  planPropertyEditBatch,
  PropertyBatchEditError,
} from "@/lib/contacts/propertyEdit";

const BASE_PERSON = {
  id: "11111111-1111-1111-1111-111111111111",
  firstName: "Eva" as string | null,
  lastName: "Editor" as string | null,
  email: "old@example.com",
  emailNormalized: "old@example.com",
  emailStatus: "verified",
  emailSource: "fi-arg-2026-mails-hunter",
  jobTitle: "Engineer",
  roleGroup: null,
  contactType: null,
  seniority: null,
  city: null,
  region: null,
  country: null,
  preferredLanguage: null as string | null,
  industry: null,
  phone: "+54 11 4000-0000",
  mobilePhone: null,
  profileKey: null as string | null,
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
    {
      personId: BASE_PERSON.id,
      property: "roleGroup",
      oldValue: null,
      newValue: "eng_leadership",
      changedByBdId: "bd-1",
      source: "edit",
    },
  ]);
});

test("null -> null (both empty) reports changed: false", () => {
  const plan = planPropertyEdit(BASE_PERSON, "city", "   ", "bd-1");
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
  const plan = planPropertyEdit(BASE_PERSON, "mobilePhone", "+54 9 11 4123-4567", "bd-1", normalizePhoneForWrite);
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.mobilePhone, "+5491141234567");
  assert.deepEqual(plan.historyRows, [
    {
      personId: BASE_PERSON.id,
      property: "mobilePhone",
      oldValue: null,
      newValue: "+5491141234567",
      changedByBdId: "bd-1",
      source: "edit",
    },
  ]);
});

test("a phone that cannot be normalized is stored as typed, never rejected for it", () => {
  const plan = planPropertyEdit(BASE_PERSON, "phone", "011 4123-4567", "bd-1", normalizePhoneForWrite);
  assert.equal(plan.personUpdate?.phone, "011 4123-4567");
});

test("a local number is completed only with an Argentine context", () => {
  const dff = { ...BASE_PERSON, sourceKey: "dff-2026" };
  assert.equal(planPropertyEdit(dff, "mobilePhone", "1155555555", "bd-1", normalizePhoneForWrite).personUpdate?.mobilePhone, "+5491155555555");
  assert.equal(planPropertyEdit(BASE_PERSON, "mobilePhone", "1155555555", "bd-1", normalizePhoneForWrite).personUpdate?.mobilePhone, "1155555555");
});

test("re-saving the same number in another format is a no-op once stored as E.164", () => {
  const stored = { ...BASE_PERSON, phone: "+541140000000" };
  assert.equal(planPropertyEdit(stored, "phone", "+54 11 4000-0000", "bd-1", normalizePhoneForWrite).changed, false);
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
      { property: "city", rawNewValue: "   " }, // null -> null, a no-op
    ],
    "bd-1",
  );
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.jobTitle, "VP of Engineering");
  assert.equal("city" in (plan.personUpdate ?? {}), false);
  assert.deepEqual(
    plan.historyRows.map((r) => r.property),
    ["jobTitle", "roleGroup"],
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
    ["email", "emailNormalized", "emailSource", "emailStatus", "jobTitle", "roleGroup"],
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

// --- contactType (contact-type-ui): editable closed-set property -----------

test("contactType is editable and sits right after jobTitle", () => {
  assert.equal(isEditablePersonProperty("contactType"), true);
  assert.equal(
    EDITABLE_PERSON_PROPERTIES[EDITABLE_PERSON_PROPERTIES.indexOf("jobTitle") + 1],
    "contactType",
  );
});

test("setting contactType writes the stored value and a history row naming the actor", () => {
  const plan = planPropertyEdit(BASE_PERSON, "contactType", "BUYER-CHAMPION", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.contactType, "BUYER-CHAMPION");
  assert.equal(plan.personUpdate?.updatedByBdId, "bd-1");
  assert.deepEqual(plan.historyRows, [
    {
      personId: BASE_PERSON.id,
      property: "contactType",
      oldValue: null,
      newValue: "BUYER-CHAMPION",
      changedByBdId: "bd-1",
      source: "edit",
    },
  ]);
});

test("changing contactType records old and new value; clearing it is allowed", () => {
  const typed = { ...BASE_PERSON, contactType: "INFLUENCER" };
  const changed = planPropertyEdit(typed, "contactType", "BUYER-CHAMPION", "bd-2");
  assert.equal(changed.historyRows[0]?.oldValue, "INFLUENCER");
  assert.equal(changed.historyRows[0]?.newValue, "BUYER-CHAMPION");
  const cleared = planPropertyEdit(typed, "contactType", "  ", "bd-2");
  assert.equal(cleared.changed, true);
  assert.equal(cleared.personUpdate?.contactType, null);
  assert.equal(cleared.historyRows[0]?.newValue, null);
});

test("contactType outside the vocabulary is rejected before any plan is built", () => {
  assert.throws(() => planPropertyEdit(BASE_PERSON, "contactType", "DECISION-MAKER", "bd-1"), InvalidContactTypeError);
  assert.throws(() => planPropertyEdit(BASE_PERSON, "contactType", "buyer-champion", "bd-1"), InvalidContactTypeError);
});

test("re-saving the same contactType is a no-op with no history row", () => {
  const plan = planPropertyEdit({ ...BASE_PERSON, contactType: "INFLUENCER" }, "contactType", "INFLUENCER", "bd-1");
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.historyRows, []);
});

// ---- profileKey (LinkedIn) -------------------------------------------------

const PERSON_WITH_PROFILE = { ...BASE_PERSON, profileKey: "linkedin.com/in/dana-whitfield" };

test("profileKey is editable and sits right after mobilePhone", () => {
  assert.ok(isEditablePersonProperty("profileKey"));
  const i = EDITABLE_PERSON_PROPERTIES.indexOf("mobilePhone");
  assert.equal(EDITABLE_PERSON_PROPERTIES[i + 1], "profileKey");
});

for (const raw of [
  "https://www.linkedin.com/in/Dana-Whitfield/",
  "linkedin.com/in/dana-whitfield",
  "  http://LinkedIn.com/in/dana-whitfield?utm_source=share  ",
]) {
  test(`profileKey accepts and normalizes ${JSON.stringify(raw)}`, () => {
    const plan = planPropertyEdit(BASE_PERSON, "profileKey", raw, "bd-1");
    assert.equal(plan.changed, true);
    assert.equal(plan.personUpdate?.profileKey, "linkedin.com/in/dana-whitfield");
    assert.deepEqual(plan.historyRows, [
      { personId: BASE_PERSON.id, property: "profileKey", oldValue: null, newValue: "linkedin.com/in/dana-whitfield", changedByBdId: "bd-1", source: "edit" },
    ]);
  });
}

test("profileKey keeps a country subdomain as the importer does, and re-saving it is a no-op", () => {
  const held = { ...BASE_PERSON, profileKey: "uk.linkedin.com/in/dana-whitfield" };
  assert.equal(planPropertyEdit(BASE_PERSON, "profileKey", "https://uk.linkedin.com/in/dana-whitfield", "bd-1").personUpdate?.profileKey, "uk.linkedin.com/in/dana-whitfield");
  assert.equal(planPropertyEdit(held, "profileKey", "https://uk.linkedin.com/in/Dana-Whitfield/", "bd-1").changed, false);
});

test("profileKey rejects company, school and site pages", () => {
  for (const raw of ["https://www.linkedin.com/company/acme", "https://www.linkedin.com/school/x", "https://www.linkedin.com/feed"]) {
    assert.throws(() => planPropertyEdit(BASE_PERSON, "profileKey", raw, "bd-1"), InvalidProfileKeyError);
  }
});

test("profileKey rejects a non-linkedin host", () => {
  for (const raw of ["https://twitter.com/dwhitfield", "https://linkedin.com.evil.example/in/x", "https://notlinkedin.com/in/x"]) {
    assert.throws(() => planPropertyEdit(BASE_PERSON, "profileKey", raw, "bd-1"), InvalidProfileKeyError);
  }
});

test("profileKey rejects a value that normalizes to null", () => {
  for (const raw of ["https://linkedin.com", "https://www.linkedin.com/", "not a url at all"]) {
    assert.throws(() => planPropertyEdit(BASE_PERSON, "profileKey", raw, "bd-1"), InvalidProfileKeyError);
  }
});

test("profileKey blank clears the profile", () => {
  const plan = planPropertyEdit(PERSON_WITH_PROFILE, "profileKey", "   ", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.profileKey, null);
  assert.equal(plan.historyRows[0]?.oldValue, "linkedin.com/in/dana-whitfield");
  assert.equal(plan.historyRows[0]?.newValue, null);
});

test("profileKey no-op: the same profile in another shape changes nothing", () => {
  const plan = planPropertyEdit(PERSON_WITH_PROFILE, "profileKey", "https://www.linkedin.com/in/Dana-Whitfield/", "bd-1");
  assert.deepEqual(plan, { changed: false, personUpdate: null, historyRows: [] });
});

test("profileKey no-op: blank on a contact with no profile", () => {
  assert.equal(planPropertyEdit(BASE_PERSON, "profileKey", "", "bd-1").changed, false);
});

test("profileKey planner is pure: same input twice, same result, input untouched", () => {
  const before = structuredClone(BASE_PERSON);
  const a = planPropertyEdit(BASE_PERSON, "profileKey", "https://www.linkedin.com/in/x", "bd-1");
  const b = planPropertyEdit(BASE_PERSON, "profileKey", "https://www.linkedin.com/in/x", "bd-1");
  assert.deepEqual({ ...a.personUpdate, updatedAt: 0 }, { ...b.personUpdate, updatedAt: 0 });
  assert.deepEqual(a.historyRows, b.historyRows);
  assert.deepEqual(BASE_PERSON, before);
});

// --- roleGroup is derived from jobTitle, never edited directly -------------

test("roleGroup is no longer an editable property", () => {
  assert.equal(isEditablePersonProperty("roleGroup"), false);
  assert.equal((EDITABLE_PERSON_PROPERTIES as readonly string[]).includes("roleGroup"), false);
});

test("a jobTitle edit re-derives roleGroup and writes both history rows", () => {
  const person = { ...BASE_PERSON, jobTitle: "Engineer", roleGroup: "developers" };
  const plan = planPropertyEdit(person, "jobTitle", "Head of Engineering", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.jobTitle, "Head of Engineering");
  assert.equal(plan.personUpdate?.roleGroup, "eng_leadership");
  assert.deepEqual(
    plan.historyRows.map((r) => [r.property, r.oldValue, r.newValue, r.changedByBdId, r.source]),
    [
      ["jobTitle", "Engineer", "Head of Engineering", "bd-1", "edit"],
      ["roleGroup", "developers", "eng_leadership", "bd-1", "edit"],
    ],
  );
});

test("a jobTitle edit that keeps the derived group writes only the jobTitle row", () => {
  const person = { ...BASE_PERSON, jobTitle: "Engineer", roleGroup: "developers" };
  const plan = planPropertyEdit(person, "jobTitle", "Software Engineer", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal("roleGroup" in (plan.personUpdate ?? {}), false);
  assert.deepEqual(plan.historyRows.map((r) => r.property), ["jobTitle"]);
});

test("clearing a real jobTitle keeps the stored roleGroup and writes only the jobTitle row", () => {
  const person = { ...BASE_PERSON, jobTitle: "Engineer", roleGroup: "developers" };
  const plan = planPropertyEdit(person, "jobTitle", "   ", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.jobTitle, null);
  assert.equal("roleGroup" in (plan.personUpdate ?? {}), false);
  assert.deepEqual(plan.historyRows.map((r) => r.property), ["jobTitle"]);
});

test("saving a blank jobTitle that is already blank writes nothing, whatever the stored group", () => {
  for (const group of ["developers", null, "no_position"]) {
    const person = { ...BASE_PERSON, jobTitle: null as string | null, roleGroup: group };
    assert.deepEqual(planPropertyEdit(person, "jobTitle", "  ", "bd-1"), {
      changed: false,
      personUpdate: null,
      historyRows: [],
    });
  }
});

test("a title matching no rule classifies to other (no_position is only the blank fallback) and is written like any group", () => {
  const person = { ...BASE_PERSON, jobTitle: "Engineer", roleGroup: "developers" };
  const plan = planPropertyEdit(person, "jobTitle", "Zzyzx Wrangler", "bd-1");
  assert.equal(plan.personUpdate?.roleGroup, "other");
  assert.deepEqual(plan.historyRows.map((r) => r.property), ["jobTitle", "roleGroup"]);
});

test("a stale roleGroup is repaired on the next jobTitle edit; a null one is filled", () => {
  const plan = planPropertyEdit(BASE_PERSON, "jobTitle", "Head of Engineering", "bd-1");
  assert.equal(plan.personUpdate?.roleGroup, "eng_leadership");
  assert.deepEqual(plan.historyRows.map((r) => [r.property, r.oldValue]), [
    ["jobTitle", "Engineer"],
    ["roleGroup", null],
  ]);
});

test("editing other properties never touches roleGroup", () => {
  const plan = planPropertyEdit({ ...BASE_PERSON, roleGroup: "developers" }, "city", "Rosario", "bd-1");
  assert.equal("roleGroup" in (plan.personUpdate ?? {}), false);
  assert.deepEqual(plan.historyRows.map((r) => r.property), ["city"]);
});

test("planPropertyEdit is pure: the same input twice gives the same plan and the input is untouched", () => {
  const person = Object.freeze({ ...BASE_PERSON, jobTitle: "Engineer", roleGroup: "developers" });
  const a = planPropertyEdit(person, "jobTitle", "Head of Engineering", "bd-1");
  const b = planPropertyEdit(person, "jobTitle", "Head of Engineering", "bd-1");
  assert.deepEqual(a.historyRows, b.historyRows);
  assert.equal(a.personUpdate?.roleGroup, b.personUpdate?.roleGroup);
  assert.equal(person.roleGroup, "developers");
});

test("saving an unchanged jobTitle still repairs a stale roleGroup (only the roleGroup row)", () => {
  const person = { ...BASE_PERSON, jobTitle: "Head of Engineering", roleGroup: "developers" };
  const plan = planPropertyEdit(person, "jobTitle", "Head of Engineering", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.roleGroup, "eng_leadership");
  assert.equal("jobTitle" in (plan.personUpdate ?? {}), false);
  assert.deepEqual(plan.historyRows.map((r) => [r.property, r.oldValue, r.newValue]), [
    ["roleGroup", "developers", "eng_leadership"],
  ]);
});

test("saving an unchanged jobTitle with an in-sync roleGroup is a no-op", () => {
  const person = { ...BASE_PERSON, jobTitle: "Engineer", roleGroup: "developers" };
  assert.deepEqual(planPropertyEdit(person, "jobTitle", "Engineer", "bd-1"), {
    changed: false,
    personUpdate: null,
    historyRows: [],
  });
});

test("the DB layer wires the phone normalizer, and the pure module never imports it (it reaches client bundles)", () => {
  assert.match(readFileSync("src/lib/contacts/propertyEditDb.ts", "utf8"), /planPropertyEdit\(row, property, rawNewValue, changedByBdId, normalizePhoneForWrite\)/);
  assert.doesNotMatch(readFileSync("src/lib/contacts/propertyEdit.ts", "utf8"), /import \{[^}]*\} from "@\/lib\/phoneNormalize"/);
  assert.equal(planPropertyEdit(BASE_PERSON, "mobilePhone", "+54 9 11 4123-4567", "bd-1").personUpdate?.mobilePhone, "+54 9 11 4123-4567", "without a normalizer the value is stored as typed");
});

// ---- firstName / lastName ---------------------------------------------------

test("firstName and lastName are allow-listed, listed before every other property", () => {
  assert.equal(isEditablePersonProperty("firstName"), true);
  assert.equal(isEditablePersonProperty("lastName"), true);
  assert.deepEqual(EDITABLE_PERSON_PROPERTIES.slice(0, 2), ["firstName", "lastName"]);
});

test("a name edit trims, collapses inner whitespace and writes one history row", () => {
  const plan = planPropertyEdit(BASE_PERSON, "firstName", "  María   José ", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.firstName, "María José");
  assert.deepEqual(plan.historyRows, [
    { personId: BASE_PERSON.id, property: "firstName", oldValue: "Eva", newValue: "María José", changedByBdId: "bd-1", source: "edit" },
  ]);
});

test("a name that only differs in whitespace from the stored one is a no-op", () => {
  assert.equal(planPropertyEdit(BASE_PERSON, "lastName", "  Editor ", "bd-1").changed, false);
});

test("clearing the first name is rejected, clearing the last name is allowed", () => {
  assert.throws(() => planPropertyEdit(BASE_PERSON, "firstName", "   ", "bd-1"), InvalidNameError);
  const plan = planPropertyEdit(BASE_PERSON, "lastName", "  ", "bd-1");
  assert.equal(plan.personUpdate?.lastName, null);
  assert.equal(plan.historyRows[0]?.newValue, null);
});

test("a contact with no first name can be given one, and an untouched blank stays a no-op", () => {
  const nameless = { ...BASE_PERSON, firstName: null };
  assert.equal(planPropertyEdit(nameless, "firstName", "", "bd-1").changed, false);
  assert.equal(planPropertyEdit(nameless, "firstName", "Ana", "bd-1").personUpdate?.firstName, "Ana");
});

test("names with control characters or beyond 200 characters are rejected", () => {
  assert.throws(() => planPropertyEdit(BASE_PERSON, "firstName", "Ev\u0000a", "bd-1"), InvalidNameError);
  assert.throws(() => planPropertyEdit(BASE_PERSON, "lastName", "Ed\u0007itor", "bd-1"), InvalidNameError);
  assert.throws(() => planPropertyEdit(BASE_PERSON, "lastName", "x".repeat(201), "bd-1"), InvalidNameError);
  assert.equal(planPropertyEdit(BASE_PERSON, "lastName", "x".repeat(200), "bd-1").changed, true);
});

// --- preferredLanguage (preferred-language): closed set es | en, empty = Automático ---------------------

test("preferredLanguage is editable and sits right after country, so the row renders after Ubicación", () => {
  assert.equal(isEditablePersonProperty("preferredLanguage"), true);
  assert.equal(EDITABLE_PERSON_PROPERTIES[EDITABLE_PERSON_PROPERTIES.indexOf("country") + 1], "preferredLanguage");
});

test("setting preferredLanguage writes the value and one history row naming the actor", () => {
  const plan = planPropertyEdit(BASE_PERSON, "preferredLanguage", " es ", "bd-1");
  assert.equal(plan.changed, true);
  assert.equal(plan.personUpdate?.preferredLanguage, "es");
  assert.equal(plan.personUpdate?.updatedByBdId, "bd-1");
  assert.deepEqual(plan.historyRows, [{ personId: BASE_PERSON.id, property: "preferredLanguage", oldValue: null, newValue: "es", changedByBdId: "bd-1", source: "edit" }]);
});

test("choosing Automático (blank) clears the preference and records the old value", () => {
  const plan = planPropertyEdit({ ...BASE_PERSON, preferredLanguage: "en" }, "preferredLanguage", "", "bd-2");
  assert.equal(plan.personUpdate?.preferredLanguage, null);
  assert.deepEqual(plan.historyRows.map((r) => [r.oldValue, r.newValue, r.changedByBdId]), [["en", null, "bd-2"]]);
});

test("a value outside es / en never reaches the column, and saving the same value writes nothing", () => {
  for (const bad of ["pt", "ES", "english", "es-AR"]) {
    assert.throws(() => planPropertyEdit(BASE_PERSON, "preferredLanguage", bad, "bd-1"), InvalidPreferredLanguageError, bad);
  }
  assert.deepEqual(planPropertyEdit({ ...BASE_PERSON, preferredLanguage: "es" }, "preferredLanguage", "es", "bd-1"), { changed: false, personUpdate: null, historyRows: [] });
});

test("correcting the contact's own country does not touch the preferred language", () => {
  const plan = planLocationEdit({ ...BASE_PERSON, preferredLanguage: "es", country: "Argentina" }, { city: "", region: "", country: "United States" }, "bd-1");
  assert.equal(plan.changed, true);
  assert.equal("preferredLanguage" in (plan.personUpdate ?? {}), false);
  assert.deepEqual(plan.historyRows.map((r) => r.property), ["country"]);
});
