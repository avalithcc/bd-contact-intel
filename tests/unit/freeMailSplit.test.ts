/**
 * The free-mail predicate is split in two on purpose (see emailPatterns.ts):
 * the broad one serves identity matching and pattern inference, the narrow one
 * serves the company-domain validator. These tests pin both halves and the
 * invariant that keeps them from drifting apart silently.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FREE_MAIL_DOMAINS,
  FREE_MAIL_ROOTS,
  UNOWNABLE_MAIL_DOMAINS,
  UNOWNABLE_MAIL_ROOTS,
  isFreeMailDomain,
  isUnownableMailDomain,
} from "@/lib/emailPatterns";
import { normalizeCompanyDomain } from "@/lib/companies/domain";

const LATAM_ISP_DOMAINS = ["terra.com.ar", "uol.com.br", "bol.com.br", "speedy.com.ar", "fibertel.com.ar", "arnet.com.ar"];
const GLOBAL_PROVIDERS = ["gmail.com", "hotmail.es", "outlook.com.ar", "yahoo.com.br", "live.com.mx", "ymail.com", "icloud.com", "proton.me", "aol.com", "gmx.de", "yandex.ru", "me.com", "mac.com", "mail.com"];

// Free mail for MATCHING, but the provider's own corporate domain, so a
// company record may legitimately carry it. See UNOWNABLE_MAIL_DOMAINS.
const PROVIDER_OWNED_DOMAINS = ["zoho.com"];

test("the narrow set is a subset of the broad one", () => {
  for (const root of UNOWNABLE_MAIL_ROOTS) {
    assert.ok(FREE_MAIL_ROOTS.has(root), `${root} is unownable but not free mail`);
  }
  for (const domain of UNOWNABLE_MAIL_DOMAINS) {
    assert.ok(FREE_MAIL_DOMAINS.has(domain), `${domain} is unownable but not free mail`);
  }
  for (const domain of [...GLOBAL_PROVIDERS, ...FREE_MAIL_DOMAINS]) {
    if (isUnownableMailDomain(domain)) assert.ok(isFreeMailDomain(domain), domain);
  }
});

test("the narrow set is exactly the broad roots minus the LATAM ISPs", () => {
  const isps = ["terra", "uol", "bol", "speedy", "fibertel", "arnet"];
  assert.deepEqual(
    [...FREE_MAIL_ROOTS].filter((r) => !isps.includes(r)).sort(),
    [...UNOWNABLE_MAIL_ROOTS].sort(),
  );
});

// The exact-domain half of the same tripwire. A broad exact domain whose first
// label the narrow ROOTS do not already cover must be classified on purpose:
// either unownable, or listed as the provider's own corporate domain. Adding
// one to FREE_MAIL_DOMAINS and nothing else fails here, which is the whole
// point — that silent inheritance is what let the validator refuse zoho.com.
test("every broad exact domain the narrow roots miss is classified on purpose", () => {
  const missedByRoots = [...FREE_MAIL_DOMAINS].filter(
    (d) => !UNOWNABLE_MAIL_ROOTS.has(d.split(".")[0] ?? ""),
  );
  assert.deepEqual(
    missedByRoots.filter((d) => !PROVIDER_OWNED_DOMAINS.includes(d)).sort(),
    [...UNOWNABLE_MAIL_DOMAINS].sort(),
  );
});

test("job A is unchanged: every LATAM ISP is still free mail", () => {
  for (const d of LATAM_ISP_DOMAINS) assert.equal(isFreeMailDomain(d), true, d);
});

test("job B: LATAM ISP domains are not unownable and pass the company-domain validator", () => {
  for (const d of LATAM_ISP_DOMAINS) {
    assert.equal(isUnownableMailDomain(d), false, d);
    assert.deepEqual(normalizeCompanyDomain(d), { ok: true, value: d }, d);
  }
  assert.deepEqual(normalizeCompanyDomain("terraform-labs.io"), { ok: true, value: "terraform-labs.io" });
});

// The same asymmetry one level down, on the exact-domain half of the lists.
// zoho.com is a consumer mailbox host AND Zoho Corporation's own corporate
// domain, so the two jobs need opposite answers for it.
test("a provider's own corporate domain is free mail for matching but savable on a company", () => {
  for (const d of PROVIDER_OWNED_DOMAINS) {
    assert.equal(isFreeMailDomain(d), true, `${d} must stay free mail for identity matching`);
    assert.equal(isUnownableMailDomain(d), false, d);
    assert.deepEqual(normalizeCompanyDomain(d), { ok: true, value: d }, d);
  }
});

test("global providers and their country variants stay refused as free_mail", () => {
  for (const d of GLOBAL_PROVIDERS) {
    assert.equal(isUnownableMailDomain(d), true, d);
    assert.deepEqual(normalizeCompanyDomain(d), { ok: false, reason: "free_mail" }, d);
  }
});

test("own_company still wins over free_mail", () => {
  for (const d of ["avalith.net", "avalith.com", "www.avalith.net"]) {
    assert.deepEqual(normalizeCompanyDomain(d), { ok: false, reason: "own_company" }, d);
  }
});

test("both predicates are case and whitespace tolerant", () => {
  assert.equal(isUnownableMailDomain("  GMAIL.com "), true);
  assert.equal(isFreeMailDomain("  FIBERTEL.com.ar "), true);
});
