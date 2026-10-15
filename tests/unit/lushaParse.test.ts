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
  isNumberFlagged,
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
  assert.deepEqual(out, { ok: true, value: "redacted-work@example.invalid", type: "work", confidence: 80, raw });
  const first = pickEmail([{ email: "a@x.invalid" }, { email: "b@x.invalid" }]);
  assert.equal(first.ok && first.value, "a@x.invalid");
  assert.equal(first.ok && first.confidence, null, "no confidence reported is null, never -Infinity");
});

/**
 * The shape of the FIRST REAL reveal (2026-10-15), with the real values replaced: Lusha returned every
 * address it holds for the person, both "work" and both graded "A+", and the one on the company's own
 * domain was NOT first. Order of arrival picked the other company's address and it was written to the
 * Contact, which is what this ranking exists to prevent.
 */
const TWO_A_PLUS = [
  { type: "work", email: "someone@other-company.invalid", confidence: "A+", dataSource: "Lusha" },
  { type: "work", email: "someone@example.invalid", confidence: "A+", dataSource: "Lusha" },
];

const chosen = (raw: unknown, domains?: readonly string[]): string | null => {
  const out = pickEmail(raw, domains);
  return out.ok ? out.value : null;
};
const graded = (confidence: unknown): number | null => {
  const out = pickEmail([{ email: "a@x.invalid", confidence }]);
  return out.ok ? out.confidence : null;
};

test("pickEmail prefers the company's own domain over Lusha's arrival order", () => {
  assert.equal(chosen(TWO_A_PLUS, ["example.invalid"]), "someone@example.invalid");
  // Lusha reports the matched domain with "www.", our own company row without it: one company either way.
  assert.equal(chosen(TWO_A_PLUS, ["www.Example.invalid"]), "someone@example.invalid");
  assert.equal(chosen(TWO_A_PLUS, ["https://example.invalid/"]), "someone@example.invalid");
  // The domain beats the type, because an address at the company we are prospecting is the one to reach.
  const personalAtCompany = [{ type: "work", email: "a@other.invalid", confidence: "A+" }, { type: "personal", email: "b@example.invalid", confidence: "B" }];
  assert.equal(chosen(personalAtCompany, ["example.invalid"]), "b@example.invalid");
});

test("our own company domain outranks the one Lusha matched", () => {
  // Lusha matched the person at a different employer than the one we hold. Treating both domains as
  // equal would hand the decision back to arrival order, which is the incident this ranking exists for.
  const domains = ["example.invalid", "other-company.invalid"]; // ours first, Lusha's second
  assert.equal(chosen(TWO_A_PLUS, domains), "someone@example.invalid");
  assert.equal(chosen([...TWO_A_PLUS].reverse(), domains), "someone@example.invalid", "arrival order must not decide");
  // Only Lusha's domain has a candidate: it still beats an address on neither domain.
  const onlyMatched = [{ type: "work", email: "a@third.invalid", confidence: "A+" }, { type: "work", email: "b@other-company.invalid", confidence: "A+" }];
  assert.equal(chosen(onlyMatched, domains), "b@other-company.invalid");
});

test("pickEmail knows no company domain and falls back to the previous order", () => {
  assert.equal(chosen(TWO_A_PLUS), "someone@other-company.invalid");
  assert.equal(chosen(TWO_A_PLUS, []), "someone@other-company.invalid");
  assert.equal(chosen(TWO_A_PLUS, [null as unknown as string, "  "]), "someone@other-company.invalid");
  // A domain we hold that neither address is on must not promote one of them either.
  assert.equal(chosen(TWO_A_PLUS, ["third.invalid"]), "someone@other-company.invalid");
});

test("a letter grade is ranked and reported on the 0-100 scale of email_confidence", () => {
  const raw = [
    { type: "work", email: "b@x.invalid", confidence: "B" },
    { type: "work", email: "aplus@x.invalid", confidence: "A+" },
    { type: "work", email: "a@x.invalid", confidence: "A" },
  ];
  assert.deepEqual(pickEmail(raw), { ok: true, value: "aplus@x.invalid", type: "work", confidence: 100, raw });
  assert.equal(graded("a-"), 89, "lowercase and a modifier are graded too");
  assert.equal(graded("F-"), 6);
  assert.equal(graded(80), 80, "a number already on the 0-100 scale is kept as it is");
  // Unknown stays unknown: an unreadable grade or a scale we cannot place is never reported as a percentage.
  for (const confidence of ["Z", "A++", "", 0.95, 101, -1, true, null]) {
    assert.equal(graded(confidence), null, `${String(confidence)} is not a 0-100 confidence`);
  }
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
  assert.deepEqual(out, { ok: true, value: "+10000000001", type: "work", confidence: 50, raw });
});

test("pickPhone fails closed with unparsable_value and keeps the raw payload", () => {
  const raw = fixture("synthetic-wrong-shape-enrich-phones.json").results[0].phones;
  assert.deepEqual(pickPhone(raw), { ok: false, reason: "unparsable_value", raw });
  assert.deepEqual(pickPhone([]), { ok: false, reason: "empty", raw: [] });
  assert.deepEqual(pickPhone("+10000000001"), { ok: false, reason: "unparsable_value", raw: "+10000000001" });
});

// --- doNotCall: a flag belongs to a number, only a literal `true` counts, and a duplicate can never hide it --------------------

const num = (over: Record<string, unknown>) => ({ type: "mobile", number: "+54 9 11 3026-1031", ...over });
const HELD = "+54 9 11 3026-1031";

test("isNumberFlagged is true only for a literal true on an entry for the held number", () => {
  assert.equal(isNumberFlagged([num({ doNotCall: true })], HELD), true);
  assert.equal(isNumberFlagged([num({ doNotCall: false })], HELD), false);
  assert.equal(isNumberFlagged([num({})], HELD), false, "missing is unknown, never a clearance and never a flag");
  for (const odd of ["true", 1, "yes", null, {}, []]) assert.equal(isNumberFlagged([num({ doNotCall: odd })], HELD), false, `non-boolean ${JSON.stringify(odd)}`);
});

test("the flag of a DIFFERENT number is never attributed to the held one", () => {
  assert.equal(isNumberFlagged([num({ number: "+54 11 4000-0001", doNotCall: true }), num({ doNotCall: false })], HELD), false);
});

test("a number listed twice is flagged when ANY of its entries is, whichever order and whichever one a tie-break would pick", () => {
  const clear = num({ doNotCall: false });
  const flagged = num({ number: "+5491130261031", doNotCall: true }); // same digits, other formatting
  assert.equal(isNumberFlagged([clear, flagged], HELD), true);
  assert.equal(isNumberFlagged([flagged, clear], HELD), true);
  assert.equal(isNumberFlagged([clear, num({})], HELD), false);
});

test("nothing is flagged without a held number or without a list", () => {
  for (const held of [null, undefined, "", "n/a"]) assert.equal(isNumberFlagged([num({ doNotCall: true })], held), false);
  for (const list of [undefined, null, "x", {}]) assert.equal(isNumberFlagged(list, HELD), false);
});
