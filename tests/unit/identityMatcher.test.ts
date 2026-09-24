/**
 * Unit tests for src/lib/identity/matcher.ts — the pure identity matcher
 * (design D3, contact-identity spec) and the pure mergeProperties helper
 * (contact-identity R7). Pure functions only, no DB — run with:
 *   npx tsx --test tests/unit/identityMatcher.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNameCompanyKey,
  emailStatusRank,
  matchIdentity,
  mergeProperties,
  mergeProperty,
  type IdentityIndex,
} from "@/lib/identity/matcher";

function emptyIndex(overrides: Partial<IdentityIndex> = {}): IdentityIndex {
  return {
    byProfileKey: () => null,
    byVerifiedEmail: () => null,
    byNameCompany: () => [],
    ...overrides,
  };
}

// --- matchIdentity: precedence order (contact-identity spec) --------------

test("LinkedIn profile key match auto-merges", () => {
  const index = emptyIndex({
    byProfileKey: (key) => (key === "linkedin.com/in/janedoe" ? "person-1" : null),
  });
  const result = matchIdentity(
    { profileKey: "https://www.linkedin.com/in/janedoe/", company: "Acme" },
    index,
  );
  assert.deepEqual(result, { kind: "auto", personId: "person-1", key: "profile_key" });
});

test("Verified-email match auto-merges", () => {
  const index = emptyIndex({
    byVerifiedEmail: (email) => (email === "jane@acme.com" ? "person-2" : null),
  });
  const result = matchIdentity(
    { email: "Jane@Acme.com", emailStatus: "verified", company: "Acme" },
    index,
  );
  assert.deepEqual(result, { kind: "auto", personId: "person-2", key: "verified_email" });
});

test("A probable (unverified) email never auto-merges, even if the index has a hit", () => {
  const index = emptyIndex({
    byVerifiedEmail: () => "person-2",
    byNameCompany: () => [],
  });
  const result = matchIdentity(
    { email: "jane@acme.com", emailStatus: "probable", company: "Acme" },
    index,
  );
  assert.notEqual(result.kind, "auto");
});

test("Name+company match never auto-merges — routes to review", () => {
  const index = emptyIndex({
    byNameCompany: (key) => (key === "jane doe::acme" ? ["person-3"] : []),
  });
  const result = matchIdentity(
    { firstName: "Jane", lastName: "Doe", company: "Acme Inc." },
    index,
  );
  assert.deepEqual(result, {
    kind: "review",
    personIds: ["person-3"],
    key: "name_company",
  });
});

test("Lead without email or LinkedIn falls back to name+company: no match becomes new", () => {
  const index = emptyIndex();
  const result = matchIdentity(
    { firstName: "Jane", lastName: "Doe", company: "Acme Inc." },
    index,
  );
  assert.deepEqual(result, { kind: "new" });
});

test("No profile key, no email, no company/name at all becomes new", () => {
  const index = emptyIndex();
  const result = matchIdentity({}, index);
  assert.deepEqual(result, { kind: "new" });
});

test("Own-company rows are skipped before any other matching", () => {
  const index = emptyIndex({
    byProfileKey: () => "person-should-not-be-returned",
  });
  const result = matchIdentity(
    { profileKey: "https://linkedin.com/in/coworker", company: "Avalith" },
    index,
  );
  assert.deepEqual(result, { kind: "skip_own_company", reason: "name" });
});

test("Own-company rows are also caught by email domain when the company field is blank", () => {
  const index = emptyIndex();
  const result = matchIdentity({ email: "someone@avalith.net" }, index);
  assert.deepEqual(result, { kind: "skip_own_company", reason: "domain" });
});

test("Profile key takes precedence over a verified email hit", () => {
  const index = emptyIndex({
    byProfileKey: () => "person-from-profile",
    byVerifiedEmail: () => "person-from-email",
  });
  const result = matchIdentity(
    {
      profileKey: "https://linkedin.com/in/janedoe",
      email: "jane@acme.com",
      emailStatus: "verified",
      company: "Acme",
    },
    index,
  );
  assert.deepEqual(result, {
    kind: "auto",
    personId: "person-from-profile",
    key: "profile_key",
  });
});

// --- buildNameCompanyKey ----------------------------------------------------

test("buildNameCompanyKey normalizes case, whitespace and company suffixes", () => {
  assert.equal(
    buildNameCompanyKey({ firstName: "  Jane ", lastName: "DOE", company: "Acme Inc." }),
    "jane doe::acme",
  );
});

test("buildNameCompanyKey is null when name or company is missing", () => {
  assert.equal(buildNameCompanyKey({ firstName: "Jane", lastName: null, company: null }), null);
  assert.equal(buildNameCompanyKey({ firstName: null, lastName: null, company: "Acme" }), null);
});

// --- mergeProperty / mergeProperties (contact-identity R7) -----------------

test("mergeProperty: non-null wins over null", () => {
  const result = mergeProperty({ value: null }, { value: "Acme" });
  assert.equal(result.value, "Acme");
  assert.equal(result.loser, null);
});

test("mergeProperty: richer (longer) value wins on a genuine conflict", () => {
  const result = mergeProperty(
    { value: "Eng" },
    { value: "Senior Software Engineer" },
  );
  assert.equal(result.value, "Senior Software Engineer");
  assert.deepEqual(result.loser, { value: "Eng" });
});

test("mergeProperty: explicit specificity overrides the length default (verified beats probable)", () => {
  const result = mergeProperty(
    { value: "jane@old.com", specificity: emailStatusRank("probable") },
    { value: "jane@acme.com", specificity: emailStatusRank("verified") },
  );
  assert.equal(result.value, "jane@acme.com");
  assert.deepEqual(result.loser, { value: "jane@old.com" });
});

test("mergeProperty: ties go to the most recent value", () => {
  const older = { value: "Acme LLC", updatedAt: new Date("2024-01-01") };
  const newer = { value: "Acme Corp", updatedAt: new Date("2024-06-01") };
  const result = mergeProperty(older, newer);
  assert.equal(result.value, "Acme Corp");
  assert.deepEqual(result.loser, { value: "Acme LLC" });
});

test("mergeProperty: identical values produce no loser", () => {
  const result = mergeProperty({ value: "Acme" }, { value: "Acme" });
  assert.equal(result.value, "Acme");
  assert.equal(result.loser, null);
});

test("mergeProperties merges every field and collects only real losers", () => {
  const a = {
    company: { value: "Acme" },
    jobTitle: { value: "Eng" },
    city: { value: null },
  };
  const b = {
    company: { value: "Acme" },
    jobTitle: { value: "Senior Engineer" },
    city: { value: "Miami" },
  };
  const { merged, losers } = mergeProperties(a, b);
  assert.equal(merged.company, "Acme");
  assert.equal(merged.jobTitle, "Senior Engineer");
  assert.equal(merged.city, "Miami");
  assert.deepEqual(losers, [{ property: "jobTitle", value: "Eng" }]);
});
