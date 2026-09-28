import { test } from "node:test";
import assert from "node:assert/strict";
import { projectContactListRowColumns } from "@/lib/contacts/contactListRowColumns";

// Perf fix (board query collapse): `getContactBoardColumns` now re-selects
// the `CONTACT_LIST_ROW_COLUMNS` shape off a ranked-rows CTE instead of off
// `person` directly, so the CTE's exposed columns and the outer projection
// must always carry the exact same key set — this is the one key builder
// both sides use (rule: "one key builder per map").
const FIXTURE_SOURCE = {
  id: "person-1",
  firstName: "Ada",
  lastName: "Lovelace",
  jobTitle: "Engineer",
  company: "Acme",
  companyKey: "acme",
  companyCanonicalName: "Acme Inc.",
  ownerBdId: "bd-1",
  ownerName: "Grace",
  status: "new",
  email: "ada@example.com",
  emailStatus: "verified",
  roleGroup: "engineering",
  industry: "tech",
  country: "US",
  sourceKey: "linkedin",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  seniority: "senior",
  phone: "+1000",
  mobilePhone: null,
  // Extra keys the projection must ignore (e.g. the CTE's own window-
  // function alias) — proves this doesn't just pass every source key
  // through unfiltered.
  brcRowNum: 1,
} as const;

test("projectContactListRowColumns picks exactly the CONTACT_LIST_ROW_COLUMNS keys, dropping anything else on the source", () => {
  const projected = projectContactListRowColumns(FIXTURE_SOURCE);
  const keys = Object.keys(projected).sort();
  assert.deepEqual(
    keys,
    [
      "companyKey",
      "companyCanonicalName",
      "company",
      "country",
      "createdAt",
      "email",
      "emailStatus",
      "firstName",
      "id",
      "industry",
      "jobTitle",
      "lastName",
      "mobilePhone",
      "ownerBdId",
      "ownerName",
      "phone",
      "roleGroup",
      "seniority",
      "sourceKey",
      "status",
    ].sort(),
  );
  assert.ok(!("brcRowNum" in projected), "must not leak the CTE's own window-function alias through");
});

test("projectContactListRowColumns passes each value through unchanged (a reference to the same underlying column expression)", () => {
  const projected = projectContactListRowColumns(FIXTURE_SOURCE);
  assert.equal(projected.id, FIXTURE_SOURCE.id);
  assert.equal(projected.createdAt, FIXTURE_SOURCE.createdAt);
  assert.equal(projected.status, FIXTURE_SOURCE.status);
});

test("projectContactListRowColumns never mutates its source object", () => {
  const clone = { ...FIXTURE_SOURCE };
  projectContactListRowColumns(clone);
  assert.deepEqual(clone, FIXTURE_SOURCE);
});
