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
  UNOWNABLE_MAIL_ROOTS,
  isFreeMailDomain,
  isUnownableMailDomain,
} from "@/lib/emailPatterns";
import { normalizeCompanyDomain } from "@/lib/companies/domain";

const LATAM_ISP_DOMAINS = ["terra.com.ar", "uol.com.br", "bol.com.br", "speedy.com.ar", "fibertel.com.ar", "arnet.com.ar"];
const GLOBAL_PROVIDERS = ["gmail.com", "hotmail.es", "outlook.com.ar", "yahoo.com.br", "live.com.mx", "ymail.com", "icloud.com", "proton.me", "aol.com", "gmx.de", "yandex.ru", "me.com", "zoho.com"];

test("the narrow set is a subset of the broad one", () => {
  for (const root of UNOWNABLE_MAIL_ROOTS) {
    assert.ok(FREE_MAIL_ROOTS.has(root), `${root} is unownable but not free mail`);
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
