/**
 * Unit tests for src/lib/companies/linkedinUrl.ts — the pure normaliser and
 * validator behind `company.linkedin_url`. One stored form
 * (`linkedin.com/company/<slug>`, same shape as `normalizeProfileKey` in
 * src/lib/csv.ts); anything that is not a company/school page is rejected.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProfileKey } from "@/lib/csv";
import {
  companyLinkedinUrlHref,
  normalizeCompanyLinkedinUrl,
  type LinkedinUrlResult,
} from "@/lib/companies/linkedinUrl";

function ok(value: string | null): LinkedinUrlResult {
  return { ok: true, value };
}
function bad(reason: "not_linkedin" | "personal_profile" | "invalid_path" | "unparseable"): LinkedinUrlResult {
  return { ok: false, reason };
}

test("a full company URL with www normalizes to the canonical form", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("https://www.linkedin.com/company/avalith/"), ok("linkedin.com/company/avalith"));
});

test("with or without https and www lands on the same form", () => {
  const forms = [
    "https://linkedin.com/company/avalith",
    "http://www.linkedin.com/company/avalith",
    "www.linkedin.com/company/avalith",
    "linkedin.com/company/avalith",
  ];
  for (const f of forms) assert.deepEqual(normalizeCompanyLinkedinUrl(f), ok("linkedin.com/company/avalith"), f);
});

test("query string and fragment junk is dropped", () => {
  assert.deepEqual(
    normalizeCompanyLinkedinUrl("https://www.linkedin.com/company/avalith/?originalSubdomain=ar&trk=x#about"),
    ok("linkedin.com/company/avalith"),
  );
});

test("trailing slashes are dropped", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("linkedin.com/company/avalith///"), ok("linkedin.com/company/avalith"));
});

test("host and slug are lowercased, same as normalizeProfileKey", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("HTTPS://WWW.LinkedIn.COM/Company/Avalith"), ok("linkedin.com/company/avalith"));
});

test("a country subdomain collapses onto linkedin.com", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("https://ar.linkedin.com/company/avalith"), ok("linkedin.com/company/avalith"));
});

test("a sub-page of a company (about, posts) keeps only the page", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("https://www.linkedin.com/company/avalith/about/"), ok("linkedin.com/company/avalith"));
});

test("school pages are accepted", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("https://www.linkedin.com/school/universidad-de-buenos-aires/"), ok("linkedin.com/school/universidad-de-buenos-aires"));
});

test("a bare slug is read as a company page", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("avalith"), ok("linkedin.com/company/avalith"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("  Avalith-Group  "), ok("linkedin.com/company/avalith-group"));
});

test("a host-less company/school path is accepted", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("company/avalith"), ok("linkedin.com/company/avalith"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("school/uba"), ok("linkedin.com/school/uba"));
});

test("blank and whitespace-only clear the field", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl(""), ok(null));
  assert.deepEqual(normalizeCompanyLinkedinUrl("   \n\t "), ok(null));
});

test("a personal profile is rejected as personal_profile", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("https://www.linkedin.com/in/john-doe/"), bad("personal_profile"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("linkedin.com/in/john-doe"), bad("personal_profile"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("in/john-doe"), bad("personal_profile"));
});

test("a non-LinkedIn host is rejected, including look-alikes", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("https://avalith.net/about"), bad("not_linkedin"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("www.avalith.com"), bad("not_linkedin"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("https://notlinkedin.com/company/avalith"), bad("not_linkedin"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("https://linkedin.com.evil.io/company/avalith"), bad("not_linkedin"));
});

test("a LinkedIn path that is neither company nor school is rejected", () => {
  for (const raw of [
    "https://www.linkedin.com/jobs/view/12345",
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/avalith",
    "https://www.linkedin.com/",
    "https://www.linkedin.com/company/",
    "https://www.linkedin.com/company",
    "https://www.linkedin.com/showcase/avalith",
  ]) {
    assert.deepEqual(normalizeCompanyLinkedinUrl(raw), bad("invalid_path"), raw);
  }
});

test("unparseable junk and non-http schemes are rejected", () => {
  assert.deepEqual(normalizeCompanyLinkedinUrl("javascript:alert(1)"), bad("not_linkedin"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("two words here"), bad("unparseable"));
  assert.deepEqual(normalizeCompanyLinkedinUrl("ftp://linkedin.com/company/avalith"), bad("not_linkedin"));
});

test("the result is idempotent: normalizing a stored value returns it unchanged", () => {
  const first = normalizeCompanyLinkedinUrl("https://www.linkedin.com/company/avalith/?x=1");
  assert.equal(first.ok, true);
  if (first.ok) assert.deepEqual(normalizeCompanyLinkedinUrl(first.value!), first);
});

test("the stored form is exactly what normalizeProfileKey produces for the same URL", () => {
  const raw = "https://www.linkedin.com/company/avalith/?originalSubdomain=ar";
  const res = normalizeCompanyLinkedinUrl(raw);
  assert.deepEqual(res, ok(normalizeProfileKey(raw)));
});

test("companyLinkedinUrlHref rebuilds an https link from the stored form and refuses anything else", () => {
  assert.equal(companyLinkedinUrlHref("linkedin.com/company/avalith"), "https://linkedin.com/company/avalith");
  assert.equal(companyLinkedinUrlHref(null), null);
  assert.equal(companyLinkedinUrlHref("javascript:alert(1)"), null);
  assert.equal(companyLinkedinUrlHref("https://evil.io/x"), null);
});
