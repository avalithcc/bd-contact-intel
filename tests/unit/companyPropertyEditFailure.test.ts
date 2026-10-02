/**
 * Unit tests for src/lib/companies/propertyEditFailure.ts. The errors are
 * produced by the real planner (never built by hand), so the classifier is
 * tested against what the write path actually throws.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CompanyNotFoundError } from "@/lib/companies/errors";
import { planCompanyPropertyEdit } from "@/lib/companies/propertyEdit";
import { propertyEditFailureMessage, propertyEditFailureOf } from "@/lib/companies/propertyEditFailure";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

const BD = "11111111-1111-1111-1111-111111111111";
const COMPANY = { companyKey: "acme", industry: null, ownerBdId: null, city: null, country: null, clientStatus: null, linkedinUrl: null };

function thrownBy(property: "linkedinUrl" | "clientStatus" | "ownerBdId", value: string): unknown {
  try {
    planCompanyPropertyEdit(COMPANY, property, value, BD, { ownerExists: false });
  } catch (e) {
    return e;
  }
  throw new Error("expected the planner to throw");
}

test("every typed planner failure is classified by kind", () => {
  assert.deepEqual(propertyEditFailureOf(thrownBy("linkedinUrl", "linkedin.com/in/x")), { kind: "linkedin", reason: "personal_profile" });
  assert.deepEqual(propertyEditFailureOf(thrownBy("clientStatus", "dormant")), { kind: "client_status" });
  assert.deepEqual(propertyEditFailureOf(thrownBy("ownerBdId", BD)), { kind: "owner" });
  assert.deepEqual(propertyEditFailureOf(new CompanyNotFoundError("acme")), { kind: "not_found" });
});

test("an unexpected error is not classified, so the caller rethrows it", () => {
  assert.equal(propertyEditFailureOf(new Error("connection reset")), null);
  assert.equal(propertyEditFailureOf(new TypeError("x")), null);
  assert.equal(propertyEditFailureOf("boom"), null);
});

test("each kind maps to its own message in both languages, never a LinkedIn one for a non-LinkedIn failure", () => {
  for (const l of [es.companyRecord, en.companyRecord]) {
    const owner = propertyEditFailureMessage({ kind: "owner" }, l);
    const status = propertyEditFailureMessage({ kind: "client_status" }, l);
    const missing = propertyEditFailureMessage({ kind: "not_found" }, l);
    const linkedin = propertyEditFailureMessage({ kind: "linkedin", reason: "not_linkedin" }, l);
    assert.equal(new Set([owner, status, missing, linkedin]).size, 4);
    assert.equal(owner, l.editErrorOwner);
    assert.equal(status, l.editErrorClientStatus);
    assert.equal(missing, l.editErrorCompanyNotFound);
  }
});
