import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSuppressed,
  normalizeSuppressionValue,
  type SuppressionRule,
} from "../../src/lib/sequences/suppression";
import type { NeverLogRule } from "../../src/lib/gmail/classify";

const address = (value: string): SuppressionRule => ({ ruleKind: "address", value });
const domain = (value: string): SuppressionRule => ({ ruleKind: "domain", value });

test("address match is case-insensitive in both directions", () => {
  assert.equal(isSuppressed("Jane@Acme.com", [address("jane@acme.com")]), true);
  assert.equal(isSuppressed("jane@acme.com", [address(normalizeSuppressionValue("address", " Jane@Acme.COM "))]), true);
});

test("a domain rule suppresses any address at that exact domain", () => {
  assert.equal(isSuppressed("anyone@acme.com", [domain("acme.com")]), true);
  assert.equal(isSuppressed("ANYONE@ACME.COM", [domain("acme.com")]), true);
});

test("a domain rule does not match a subdomain or a look-alike domain", () => {
  assert.equal(isSuppressed("a@mail.acme.com", [domain("acme.com")]), false);
  assert.equal(isSuppressed("a@notacme.com", [domain("acme.com")]), false);
});

test("no rules, or no matching rule, is not suppressed", () => {
  assert.equal(isSuppressed("jane@acme.com", []), false);
  assert.equal(isSuppressed("jane@acme.com", [address("john@acme.com"), domain("other.com")]), false);
});

test("an unparseable address fails closed", () => {
  assert.equal(isSuppressed("", []), true);
  assert.equal(isSuppressed("not-an-address", []), true);
});

test("normalization reuses the never-log rule: trims, lowercases, strips a leading @ on domains", () => {
  assert.equal(normalizeSuppressionValue("domain", " @Acme.COM "), "acme.com");
  assert.equal(normalizeSuppressionValue("address", " Jane@Acme.com "), "jane@acme.com");
});

test("SuppressionRule and NeverLogRule are distinct types", () => {
  const suppression: SuppressionRule = address("jane@acme.com");
  // @ts-expect-error a SuppressionRule must not be assignable to the classifier's NeverLogRule
  const asNeverLog: NeverLogRule = suppression;
  void asNeverLog;
  const neverLog: NeverLogRule = { kind: "address", value: "jane@acme.com" };
  // @ts-expect-error a NeverLogRule must not be assignable to a SuppressionRule
  const asSuppression: SuppressionRule = neverLog;
  void asSuppression;
});
