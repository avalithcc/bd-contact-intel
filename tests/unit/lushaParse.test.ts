import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LushaError } from "../../src/lib/lusha/errors";
import {
  matchByClientReferenceId,
  parseEnrichResponse,
  parseSearchResponse,
  pickEmail,
  pickPhone,
} from "../../src/lib/lusha/parse";

const fixture = (name: string): any => JSON.parse(readFileSync(join(__dirname, "fixtures", "lusha", name), "utf8"));
const ID = "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA";
const kindOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof LushaError, "expected a LushaError");
    return e.kind;
  }
  assert.fail("expected a throw");
};

test("matchByClientReferenceId matches on the reference, never on position", () => {
  const results = [
    { clientReferenceId: "person-bbb", id: "b" },
    { clientReferenceId: "person-aaa", id: "a" },
    { clientReferenceId: "person-ccc", id: "c" },
  ];
  assert.equal((matchByClientReferenceId(results, "person-aaa") as any).id, "a");
  assert.equal(matchByClientReferenceId(results, "person-zzz"), null);
  assert.equal(matchByClientReferenceId("nope", "person-aaa"), null);
});

test("parseSearchResponse finds the match in a reordered results array", () => {
  const body = fixture("search-matched.json");
  body.results.unshift({ clientReferenceId: "person-other", id: "lusha-other", company: { name: "X", domain: "x.com" } });
  const out = parseSearchResponse(body, "person-aaa");
  assert.equal(out.outcome, "matched");
  if (out.outcome !== "matched") return;
  assert.equal(out.lushaId, "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA");
  assert.deepEqual(out.identity, {
    name: "Example Person",
    company: "Example Co",
    domain: "www.example.com",
    linkedin: "https://www.linkedin.com/in/example-person",
  });
  assert.deepEqual(out.canReveal, [
    { field: "emails", credits: 1 },
    { field: "phones", credits: 5 },
  ]);
});

test("parseSearchResponse yields no_match for NOT_FOUND and for a missing result", () => {
  assert.deepEqual(parseSearchResponse(fixture("unverified-search-not-found.json"), "person-aaa"), { outcome: "no_match", creditsCharged: 0, lowBalance: null });
  assert.deepEqual(parseSearchResponse({ results: [] }, "person-aaa"), { outcome: "no_match", creditsCharged: null, lowBalance: null });
});

test("parseSearchResponse maps a compliance restriction and an async job to typed errors", () => {
  assert.equal(kindOf(() => parseSearchResponse(fixture("unverified-search-compliance-restricted.json"), "person-aaa")), "compliance_restricted");
  assert.equal(kindOf(() => parseSearchResponse(fixture("unverified-enrich-async-job.json"), "person-aaa")), "async_unsupported");
  assert.equal(kindOf(() => parseSearchResponse(null, "person-aaa")), "unparsable_value");
});

test("parseEnrichResponse returns the raw arrays and the billed credits", () => {
  const out = parseEnrichResponse(fixture("unverified-enrich-emails.json"), "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA");
  assert.equal((out.emails as unknown[]).length, 3);
  assert.deepEqual(out.phones, []);
  assert.equal(out.creditsCharged, 1);
});

test("WATERFALL_NOT_IN_PLAN / partial is a no-value success, not an error", () => {
  const out = parseEnrichResponse(fixture("enrich-waterfall-partial.json"), "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA");
  assert.equal(out.emails, undefined);
  assert.equal(out.creditsCharged, 0);
  assert.equal(out.partial, true);
});

test("real-shaped enrich result with NO emails key is a real no-value (key absent stays undefined)", () => {
  const body = fixture("enrich-waterfall-partial.json");
  assert.ok(!("emails" in body.results[0]) && !("phones" in body.results[0]));
  const absent = parseEnrichResponse(body, ID);
  assert.equal(absent.emails, undefined);
  assert.deepEqual(pickEmail(absent.emails), { ok: false, reason: "empty", raw: undefined });
  body.results[0].emails = [];
  assert.deepEqual(pickEmail(parseEnrichResponse(body, ID).emails), { ok: false, reason: "empty", raw: [] });
});

test("a present key with the WRONG type keeps the raw value so pickEmail fails closed", () => {
  for (const wrong of [{}, "x", 5, null]) {
    const body = fixture("unverified-enrich-emails.json");
    body.results[0].emails = wrong;
    const out = parseEnrichResponse(body, ID);
    assert.equal(out.emails, wrong);
    assert.deepEqual(pickEmail(out.emails), { ok: false, reason: "unparsable_value", raw: wrong });
  }
});

test("an unreadable enrich body never reads as a clean no-value", () => {
  assert.equal(kindOf(() => parseEnrichResponse({}, ID)), "unparsable_value");
  assert.equal(kindOf(() => parseEnrichResponse({ results: [], billing: { creditsCharged: 1 } }, ID)), "unparsable_value");
  assert.equal(kindOf(() => parseEnrichResponse({ results: "x" }, ID)), "unparsable_value");
  assert.equal(kindOf(() => parseEnrichResponse({ results: [{ id: "someone-else" }] }, ID)), "unparsable_value");
  assert.equal(kindOf(() => parseEnrichResponse(null, ID)), "unparsable_value");
  // partial is Lusha saying "no data": an absent entry is then a genuine no-value
  const partial = parseEnrichResponse({ results: [], status: "partial", billing: { creditsCharged: 0 } }, ID);
  assert.equal(partial.emails, undefined);
  assert.equal(partial.creditsCharged, 0);
});

test("search outcomes carry the billed credits; a missing or invalid billing is null, not 0", () => {
  const matched = parseSearchResponse(fixture("search-matched.json"), "person-aaa");
  assert.equal(matched.creditsCharged, 1);
  for (const bad of [-1, 1.5, "1", null]) {
    const body = fixture("search-matched.json");
    body.billing.creditsCharged = bad;
    assert.equal(parseSearchResponse(body, "person-aaa").creditsCharged, null);
  }
});

test("a charged entry with no usable id is unparsable_value, not a stored no_match", () => {
  for (const id of [undefined, "", "  ", 42]) {
    const body = fixture("search-matched.json");
    if (id === undefined) delete body.results[0].id;
    else body.results[0].id = id;
    assert.equal(kindOf(() => parseSearchResponse(body, "person-aaa")), "unparsable_value");
  }
  assert.equal(kindOf(() => parseSearchResponse({}, "person-aaa")), "unparsable_value");
  assert.equal(kindOf(() => parseSearchResponse({ results: "x" }, "person-aaa")), "unparsable_value");
});

test("a duplicated clientReferenceId fails closed instead of first-wins", () => {
  const dup = [{ clientReferenceId: "p", id: "a" }, { clientReferenceId: "p", id: "b" }];
  assert.equal(kindOf(() => matchByClientReferenceId(dup, "p")), "unparsable_value");
  const body = fixture("search-matched.json");
  body.results.push({ ...body.results[0], id: "v1.other" });
  assert.equal(kindOf(() => parseSearchResponse(body, "person-aaa")), "unparsable_value");
});

test("confidence compares by typeof: null and true do not outrank a real number", () => {
  const raw = [
    { email: "a@x.invalid", type: "work", confidence: null },
    { email: "b@x.invalid", type: "work", confidence: true },
    { email: "c@x.invalid", type: "work", confidence: 0 },
  ];
  const out = pickEmail(raw);
  assert.equal(out.ok && out.value, "c@x.invalid");
});

test("top-level status/statusReason and billing.lowBalance are surfaced; partial stays a no-value success", () => {
  const out = parseEnrichResponse(fixture("enrich-waterfall-partial.json"), "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA");
  assert.equal(out.partial, true);
  assert.equal(out.statusReason, "WATERFALL_NOT_IN_PLAN");
  assert.equal(out.lowBalance, false);
  const search = parseSearchResponse(fixture("search-matched.json"), "person-aaa");
  assert.equal(search.lowBalance, false);
  const low = fixture("search-matched.json");
  low.billing.lowBalance = true;
  assert.equal(parseSearchResponse(low, "person-aaa").lowBalance, true);
});

test("v1.<base64-ish> ids are opaque strings, and unknown extra keys change nothing", () => {
  const base = parseSearchResponse(fixture("search-matched.json"), "person-aaa");
  const noisy = fixture("search-matched.json");
  noisy.surprise = { a: 1 };
  noisy.results[0].futureKey = [1, 2];
  noisy.results[0].company.futureCompanyKey = "x";
  noisy.billing.futureBillingKey = 7;
  assert.deepEqual(parseSearchResponse(noisy, "person-aaa"), base);
  assert.ok(base.outcome === "matched" && base.lushaId.startsWith("v1."));
  const e = fixture("enrich-waterfall-partial.json");
  const before = parseEnrichResponse(e, "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA");
  e.results[0].futureKey = "x";
  e.futureTopLevel = true;
  assert.deepEqual(parseEnrichResponse(e, "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA"), before);
});

test("parseEnrichResponse maps per-contact errors and the async job", () => {
  assert.equal(kindOf(() => parseEnrichResponse(fixture("unverified-enrich-failed.json"), "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA")), "enrich_failed");
  assert.equal(kindOf(() => parseEnrichResponse(fixture("unverified-enrich-compliance-restricted.json"), "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA")), "compliance_restricted");
  assert.equal(kindOf(() => parseEnrichResponse(fixture("unverified-enrich-async-job.json"), "v1.SYNTHETICcontactIdAAAAAAAAAAAAAAAAAAAA")), "async_unsupported");
});

test("pickEmail prefers work, then highest confidence, never blindly element zero", () => {
  const raw = fixture("unverified-enrich-emails.json").results[0].emails;
  const out = pickEmail(raw);
  assert.deepEqual(out, { ok: true, value: "redacted-work@example.invalid", type: "work", raw });
  const first = pickEmail([{ email: "a@x.invalid" }, { email: "b@x.invalid" }]);
  assert.equal(first.ok && first.value, "a@x.invalid");
});

test("pickEmail returns an empty outcome for [] and fails closed on a wrong shape", () => {
  assert.deepEqual(pickEmail([]), { ok: false, reason: "empty", raw: [] });
  const bad = [{ address: "a@x.invalid" }];
  assert.deepEqual(pickEmail(bad), { ok: false, reason: "unparsable_value", raw: bad });
  assert.deepEqual(pickEmail([{ email: "not-an-email" }]).ok, false);
});

test("pickPhone is deterministic over the synthetic (unverified) phone fixture", () => {
  const raw = fixture("synthetic-unverified-enrich-phones.json").results[0].phones;
  const out = pickPhone(raw);
  assert.deepEqual(out, { ok: true, value: "+10000000001", type: "work", raw });
});

test("pickPhone fails closed with unparsable_value and keeps the raw payload", () => {
  const raw = fixture("synthetic-wrong-shape-enrich-phones.json").results[0].phones;
  assert.deepEqual(pickPhone(raw), { ok: false, reason: "unparsable_value", raw });
  assert.deepEqual(pickPhone([]), { ok: false, reason: "empty", raw: [] });
  assert.deepEqual(pickPhone("+10000000001"), { ok: false, reason: "unparsable_value", raw: "+10000000001" });
});
