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
  assert.equal(out.lushaId, "lusha-contact-111");
  assert.deepEqual(out.identity, {
    name: "Example Person",
    company: "Example Co",
    domain: "example.com",
    linkedin: "https://www.linkedin.com/in/example-person",
  });
  assert.deepEqual(out.canReveal, [
    { field: "emails", credits: 1 },
    { field: "phones", credits: 5 },
  ]);
});

test("parseSearchResponse yields no_match for NOT_FOUND and for a missing result", () => {
  assert.deepEqual(parseSearchResponse(fixture("search-not-found.json"), "person-aaa"), { outcome: "no_match" });
  assert.deepEqual(parseSearchResponse({ results: [] }, "person-aaa"), { outcome: "no_match" });
});

test("parseSearchResponse maps a compliance restriction and an async job to typed errors", () => {
  assert.equal(kindOf(() => parseSearchResponse(fixture("search-compliance-restricted.json"), "person-aaa")), "compliance_restricted");
  assert.equal(kindOf(() => parseSearchResponse(fixture("enrich-async-job.json"), "person-aaa")), "async_unsupported");
  assert.equal(kindOf(() => parseSearchResponse(null, "person-aaa")), "unavailable");
});

test("parseEnrichResponse returns the raw arrays and the billed credits", () => {
  const out = parseEnrichResponse(fixture("enrich-emails.json"), "lusha-contact-111");
  assert.equal(out.emails.length, 3);
  assert.deepEqual(out.phones, []);
  assert.equal(out.creditsCharged, 1);
});

test("WATERFALL_NOT_IN_PLAN / partial is a no-value success, not an error", () => {
  const out = parseEnrichResponse(fixture("enrich-waterfall-partial.json"), "lusha-contact-111");
  assert.deepEqual(out.emails, []);
  assert.equal(out.creditsCharged, 0);
  assert.equal(out.partial, true);
});

test("parseEnrichResponse maps per-contact errors and the async job", () => {
  assert.equal(kindOf(() => parseEnrichResponse(fixture("enrich-failed.json"), "lusha-contact-111")), "enrich_failed");
  assert.equal(kindOf(() => parseEnrichResponse(fixture("enrich-compliance-restricted.json"), "lusha-contact-111")), "compliance_restricted");
  assert.equal(kindOf(() => parseEnrichResponse(fixture("enrich-async-job.json"), "lusha-contact-111")), "async_unsupported");
});

test("pickEmail prefers work, then highest confidence, never blindly element zero", () => {
  const raw = fixture("enrich-emails.json").results[0].emails;
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
