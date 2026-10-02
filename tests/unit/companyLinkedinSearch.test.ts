/**
 * `/companies` search routed through the LinkedIn normaliser: a pasted URL
 * must be normalised to the stored canonical form before matching, otherwise
 * it can never equal a stored value. Db-free (schema-only imports).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { company } from "@/db/schema";
import { companyLinkedinSearchTerm, normalizeCompanyLinkedinUrl } from "@/lib/companies/linkedinUrl";
import { companySearchCondition } from "@/lib/companies/searchCondition";

const dialect = new PgDialect();

function render(q: string) {
  return dialect.sqlToQuery(sql`select 1 from ${company} where ${companySearchCondition(q)}`);
}

test("search term: a pasted full URL routes to an exact match on the normalised value", () => {
  assert.deepEqual(companyLinkedinSearchTerm("https://www.linkedin.com/company/Acme/?x=1"), {
    kind: "exact",
    value: "linkedin.com/company/acme",
  });
});

test("search term: the routed value is exactly what the column normaliser stores", () => {
  for (const raw of ["https://es.linkedin.com/company/acme/about/", "linkedin.com/school/mit", "company/acme"]) {
    const stored = normalizeCompanyLinkedinUrl(raw);
    assert.ok(stored.ok && stored.value);
    assert.deepEqual(companyLinkedinSearchTerm(raw), { kind: "exact", value: stored.value });
  }
});

test("search term: a bare word routes as a slug", () => {
  assert.deepEqual(companyLinkedinSearchTerm("Acme"), { kind: "slug", slug: "acme" });
});

test("search term: personal profiles, other hosts, other schemes and junk are not LinkedIn terms", () => {
  for (const raw of ["https://linkedin.com/in/jane", "in/jane", "acme.com", "https://acme.com/company/x", "ftp://linkedin.com/company/x", "a%b$c", "", "   "]) {
    assert.equal(companyLinkedinSearchTerm(raw), null, raw);
  }
});

test("search: a pasted full URL matches the stored value by equality, nothing else", () => {
  const { sql: text, params } = render("https://www.linkedin.com/company/acme/?x=1");
  assert.match(text, /"linkedin_url" = \$1/);
  assert.doesNotMatch(text, /ilike/i);
  assert.deepEqual(params, ["linkedin.com/company/acme"]);
});

test("search: a school URL and a regional subdomain collapse to the stored form", () => {
  assert.deepEqual(render("https://ar.linkedin.com/school/uba/").params, ["linkedin.com/school/uba"]);
});

test("search: a bare word still searches name/domain/alias AND the LinkedIn slug", () => {
  const { sql: text, params } = render("acme");
  assert.match(text, /"display_name" ilike \$1/i);
  assert.match(text, /"linkedin_url" ilike \$4/i);
  assert.deepEqual(params, ["%acme%", "%acme%", "%acme%", "linkedin.com/%/%acme%"]);
});

test("search: the slug pattern cannot match the kind segment (token `company` is not every company)", () => {
  assert.equal(render("company").params[3], "linkedin.com/%/%company%");
});

test("search: LIKE wildcards in a slug are escaped", () => {
  assert.equal(render("a_b").params[3], "linkedin.com/%/%a\\_b%");
});

test("search: a /in/ URL falls back to the existing behaviour for that term", () => {
  const { sql: text, params } = render("https://linkedin.com/in/jane");
  assert.doesNotMatch(text, /linkedin_url/);
  assert.deepEqual(params, Array(3).fill("%https://linkedin.com/in/jane%"));
});

test("search: a non-LinkedIn term (a domain) falls back to the existing behaviour", () => {
  const { sql: text, params } = render("acme.com");
  assert.doesNotMatch(text, /linkedin_url/);
  assert.deepEqual(params, Array(3).fill("%acme.com%"));
});

test("search: blank adds no condition", () => {
  assert.equal(companySearchCondition("   "), undefined);
});

test("search: tokens are routed independently and ANDed", () => {
  const { params } = render("globant https://linkedin.com/company/globant-ar");
  assert.deepEqual(params, [
    "%globant%",
    "%globant%",
    "%globant%",
    "linkedin.com/%/%globant%",
    "linkedin.com/company/globant-ar",
  ]);
});

test("search: repeatable on the same input", () => {
  assert.deepEqual(render("acme https://linkedin.com/company/x"), render("acme https://linkedin.com/company/x"));
});
