import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CC, checkCcList } from "@/lib/email/recipients/cc";
import { MAX_PARA, evaluatePara, type ParaPerson } from "@/lib/email/recipients/para";

test("CC accepts only exact @avalith.net, case-insensitive, and lowercases", () => {
  const r = checkCcList(["Ana@Avalith.NET", "  bob@avalith.net "], []);
  assert.deepEqual(r, { ok: true, cc: ["ana@avalith.net", "bob@avalith.net"] });
});

test("CC rejects other domains, subdomains and lookalikes", () => {
  for (const bad of [
    "ana@avalith.com",
    "ana@mail.avalith.net",
    "ana@avalith.net.evil.com",
    "ana@evilavalith.net",
    "ana@avalith.network",
    "ana@xavalith.net",
    "ana@avalith.net.",
    "ana@avalіth.net", // Cyrillic i
    "ana@gmail.com",
  ]) {
    assert.deepEqual(checkCcList([bad], []), { ok: false, reason: "cc_not_internal" }, bad);
  }
});

test("CC rejects malformed values, lists and header injection", () => {
  for (const bad of ["", "ana", "ana@", "@avalith.net", "ana@@avalith.net", "Ana <ana@avalith.net>", "a@avalith.net, b@avalith.net", "ana@avalith.net\r\nBcc: x@y.test", "ana@avalith.net\0"]) {
    const r = checkCcList([bad], []);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test("CC dedupes, drops addresses already in Para, and is capped", () => {
  assert.deepEqual(checkCcList(["a@avalith.net", "A@avalith.net", "b@avalith.net"], ["b@avalith.net"]), { ok: true, cc: ["a@avalith.net"] });
  const many = Array.from({ length: MAX_CC + 1 }, (_, i) => `u${i}@avalith.net`);
  assert.deepEqual(checkCcList(many, []), { ok: false, reason: "cc_too_many" });
  assert.deepEqual(checkCcList([], []), { ok: true, cc: [] });
});

const p = (id: string, over: Partial<ParaPerson> = {}): ParaPerson => ({
  id,
  firstName: id.toUpperCase(),
  lastName: "X",
  email: `${id}@acme.test`,
  emailNormalized: `${id}@acme.test`,
  canonicalCompanyKey: "acme",
  ...over,
});

test("Para: the record's contact first, then others of the same company", () => {
  const r = evaluatePara(p("a"), [p("b"), p("c")]);
  assert.equal(r.ok && r.recipients.map((x) => x.personId).join(), "a,b,c");
});

test("Para: a contact of another company is refused", () => {
  assert.deepEqual(evaluatePara(p("a"), [p("b", { canonicalCompanyKey: "other" })]), { ok: false, reason: "recipient_other_company" });
});

test("Para: alias keys count as the same company only after canonicalisation (the resolver supplies the canonical key)", () => {
  const r = evaluatePara(p("a", { canonicalCompanyKey: "acme" }), [p("b", { canonicalCompanyKey: "acme" })]);
  assert.equal(r.ok, true);
});

test("Para: a primary without company can only send to itself", () => {
  assert.equal(evaluatePara(p("a", { canonicalCompanyKey: null }), []).ok, true);
  assert.deepEqual(evaluatePara(p("a", { canonicalCompanyKey: null }), [p("b", { canonicalCompanyKey: null })]), { ok: false, reason: "recipient_other_company" });
});

test("Para: a missing, merged-away or unknown recipient is refused", () => {
  assert.deepEqual(evaluatePara(p("a"), [undefined]), { ok: false, reason: "recipient_unavailable" });
  assert.deepEqual(evaluatePara(undefined, []), { ok: false, reason: "recipient_unavailable" });
});

test("Para: every recipient needs an email", () => {
  assert.deepEqual(evaluatePara(p("a"), [p("b", { email: null, emailNormalized: null })]), { ok: false, reason: "recipient_no_email" });
  assert.deepEqual(evaluatePara(p("a", { email: "  ", emailNormalized: "" }), []), { ok: false, reason: "recipient_no_email" });
});

test("Para: a malformed stored address is refused, not sent", () => {
  assert.deepEqual(evaluatePara(p("a"), [p("b", { email: "no-at-sign", emailNormalized: "no-at-sign" })]), { ok: false, reason: "invalid_email" });
});

test("Para: dedupes by person and by normalised email, keeping the first", () => {
  const r = evaluatePara(p("a"), [p("b"), p("b"), p("c", { email: "A@acme.test", emailNormalized: "a@acme.test" })]);
  assert.equal(r.ok && r.recipients.map((x) => x.personId).join(), "a,b");
});

test("Para: at most 20 recipients after dedupe", () => {
  const ok = Array.from({ length: MAX_PARA - 1 }, (_, i) => p(`u${i}`));
  assert.equal(evaluatePara(p("a"), ok).ok, true);
  const tooMany = Array.from({ length: MAX_PARA }, (_, i) => p(`u${i}`));
  assert.deepEqual(evaluatePara(p("a"), tooMany), { ok: false, reason: "too_many_recipients" });
});

test("Para: the To header text lists the addresses joined by comma", () => {
  const r = evaluatePara(p("a"), [p("b")]);
  assert.equal(r.ok && r.to, "a@acme.test, b@acme.test");
});
