/**
 * Unit tests for src/lib/companies/domain.ts — the pure normaliser and
 * validator behind `company.domain`. One stored form (lowercase host, no
 * protocol, no `www.`, no path/port/whitespace), measured on all 2,701
 * production domains; anything that is not a plain hostname is rejected.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import {
  companyDomainErrorMessage,
  companyDomainHref,
  normalizeCompanyDomain,
  type DomainRejection,
  type DomainResult,
} from "@/lib/companies/domain";

function ok(value: string | null): DomainResult {
  return { ok: true, value };
}
function bad(reason: DomainRejection): DomainResult {
  return { ok: false, reason };
}

// Real values read from production company.domain (2026-10-09). Every stored
// row must survive a re-edit unchanged, or a no-op save would start failing.
const PRODUCTION_SAMPLES = [
  "ginkofs.com",
  "metinca.cl",
  "pomelo.la",
  "clear-tech.com",
  "bynder.com",
  "sophilabs.com",
  "bancogalicia.com.ar",
  "galicia.ar",
  "kavak.com",
  "gfgsa.com",
  "sustentables.com.uy",
  "baufest.com",
  "somosinventiva.com",
];

test("every sampled production domain normalizes to itself", () => {
  for (const d of PRODUCTION_SAMPLES) assert.deepEqual(normalizeCompanyDomain(d), ok(d), d);
});

test("normalizing is idempotent", () => {
  for (const raw of ["https://www.Foo.com/about?x=1", " Foo.COM ", ...PRODUCTION_SAMPLES]) {
    const first = normalizeCompanyDomain(raw);
    assert.equal(first.ok, true, raw);
    if (first.ok && first.value) assert.deepEqual(normalizeCompanyDomain(first.value), first, raw);
  }
});

test("a pasted URL lands on the bare host", () => {
  assert.deepEqual(normalizeCompanyDomain("https://www.Foo.com/about?x=1#top"), ok("foo.com"));
  assert.deepEqual(normalizeCompanyDomain("http://foo.com"), ok("foo.com"));
  assert.deepEqual(normalizeCompanyDomain("//foo.com/x"), ok("foo.com"));
  assert.deepEqual(normalizeCompanyDomain("HTTPS://FOO.COM/"), ok("foo.com"));
});

test("case, whitespace around, www, port and trailing dot are dropped", () => {
  assert.deepEqual(normalizeCompanyDomain("Foo.COM"), ok("foo.com"));
  assert.deepEqual(normalizeCompanyDomain("  foo.com\n"), ok("foo.com"));
  assert.deepEqual(normalizeCompanyDomain("www.foo.com"), ok("foo.com"));
  assert.deepEqual(normalizeCompanyDomain("foo.com:8080/x"), ok("foo.com"));
  assert.deepEqual(normalizeCompanyDomain("foo.com."), ok("foo.com"));
});

test("other subdomains are kept: the registrable domain is not guessed", () => {
  assert.deepEqual(normalizeCompanyDomain("careers.foo.com.ar"), ok("careers.foo.com.ar"));
});

test("blank or whitespace-only input clears the field", () => {
  assert.deepEqual(normalizeCompanyDomain(""), ok(null));
  assert.deepEqual(normalizeCompanyDomain("  \t "), ok(null));
});

test("a bare word with no dot is rejected, localhost included", () => {
  assert.deepEqual(normalizeCompanyDomain("avalith"), bad("no_tld"));
  assert.deepEqual(normalizeCompanyDomain("localhost"), bad("no_tld"));
  assert.deepEqual(normalizeCompanyDomain("localhost:3000"), bad("no_tld"));
});

test("an email address is rejected, never reduced to its domain", () => {
  assert.deepEqual(normalizeCompanyDomain("juan@foo.com"), bad("email"));
  assert.deepEqual(normalizeCompanyDomain("mailto:juan@foo.com"), bad("email"));
  assert.deepEqual(normalizeCompanyDomain("https://user@foo.com"), bad("email"));
});

test("an IP address is rejected", () => {
  assert.deepEqual(normalizeCompanyDomain("192.168.0.1"), bad("ip_address"));
  assert.deepEqual(normalizeCompanyDomain("http://10.0.0.1/admin"), bad("ip_address"));
  assert.deepEqual(normalizeCompanyDomain("[::1]"), bad("ip_address"));
});

test("whitespace inside the text is rejected", () => {
  assert.deepEqual(normalizeCompanyDomain("foo .com"), bad("unparseable"));
  assert.deepEqual(normalizeCompanyDomain("foo.com bar.com"), bad("unparseable"));
});

test("a path-only string or a scheme without a host is rejected", () => {
  assert.deepEqual(normalizeCompanyDomain("/about"), bad("unparseable"));
  assert.deepEqual(normalizeCompanyDomain("https://"), bad("unparseable"));
  assert.deepEqual(normalizeCompanyDomain("https:foo.com"), bad("unparseable"));
  assert.deepEqual(normalizeCompanyDomain("?x=1"), bad("unparseable"));
});

test("a scheme other than http(s) is rejected", () => {
  assert.deepEqual(normalizeCompanyDomain("ftp://foo.com"), bad("not_http"));
  assert.deepEqual(normalizeCompanyDomain("javascript:alert(1)"), bad("not_http"));
  assert.deepEqual(normalizeCompanyDomain("file:///etc/passwd"), bad("not_http"));
});

test("a non-ASCII domain is rejected rather than silently converted", () => {
  assert.deepEqual(normalizeCompanyDomain("münchen.de"), bad("non_ascii"));
  assert.deepEqual(normalizeCompanyDomain("https://España.es"), bad("non_ascii"));
});

test("an already-punycode domain is accepted as written", () => {
  assert.deepEqual(normalizeCompanyDomain("xn--mnchen-3ya.de"), ok("xn--mnchen-3ya.de"));
});

test("malformed hostnames are rejected", () => {
  for (const raw of ["foo..com", ".foo.com", "-foo.com", "foo-.com", "foo_bar.com", "*.foo.com", "foo.c", "foo.123", "fo%20o.com", "foo.com\\x"]) {
    const r = normalizeCompanyDomain(raw);
    assert.equal(r.ok, false, raw);
  }
  assert.deepEqual(normalizeCompanyDomain("foo..com"), bad("invalid_host"));
  assert.deepEqual(normalizeCompanyDomain(`${"a".repeat(64)}.com`), bad("invalid_host"));
});

test("a consumer mail provider is rejected", () => {
  assert.deepEqual(normalizeCompanyDomain("gmail.com"), bad("free_mail"));
  assert.deepEqual(normalizeCompanyDomain("https://www.hotmail.com"), bad("free_mail"));
});

test("Avalith's own domains are rejected after normalisation", () => {
  for (const raw of ["avalith.net", "avalith.com", "www.avalith.net", "AVALITH.NET", "https://www.Avalith.com/team"]) {
    assert.deepEqual(normalizeCompanyDomain(raw), bad("own_company"), raw);
  }
});

test("every rejection reason has a message in both languages", () => {
  const reasons: DomainRejection[] = ["not_http", "email", "ip_address", "no_tld", "non_ascii", "invalid_host", "free_mail", "own_company", "unparseable"];
  for (const l of [es.companyRecord, en.companyRecord]) {
    const messages = reasons.map((r) => companyDomainErrorMessage(r, l));
    assert.equal(new Set(messages).size, reasons.length);
    for (const m of messages) assert.ok(m && m.length > 10);
  }
});

test("a link is built only from a value already in the stored form", () => {
  assert.equal(companyDomainHref("galicia.ar"), "https://galicia.ar");
  assert.equal(companyDomainHref(null), null);
  assert.equal(companyDomainHref("javascript:alert(1)"), null);
  assert.equal(companyDomainHref("Foo.com/x"), null);
});
