import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProfileKey } from "@/lib/csv";
import { linkedinProfileHref, normalizeLinkedinProfileKey } from "@/lib/contacts/linkedinProfile";

// The importers write profile_key with normalizeProfileKey; a hand edit must
// produce the SAME shape or a later import row will not match it. This
// agreement is what stops the two writers drifting apart.
test("normalizeLinkedinProfileKey returns exactly what normalizeProfileKey returns", () => {
  for (const raw of [
    "https://www.linkedin.com/in/Ana-Paz/?x=1",
    "https://uk.linkedin.com/in/ana-paz",
    "https://ar.linkedin.com/in/Ana-Paz/",
    "linkedin.com/in/ana-paz",
    "  http://LinkedIn.com/in/ana-paz#frag ",
    "https://www.linkedin.com/pub/ana-paz/1/2/3",
  ]) {
    assert.deepEqual(normalizeLinkedinProfileKey(raw), { ok: true, value: normalizeProfileKey(raw) }, raw);
  }
});

test("a subdomain is kept as the importer keeps it, not collapsed", () => {
  assert.deepEqual(normalizeLinkedinProfileKey("https://uk.linkedin.com/in/x"), { ok: true, value: "uk.linkedin.com/in/x" });
});

test("only personal profile paths (/in/, /pub/) are accepted", () => {
  for (const raw of [
    "https://www.linkedin.com/company/acme",
    "https://linkedin.com/school/mit",
    "https://www.linkedin.com/feed",
    "https://www.linkedin.com/jobs/view/1",
    "https://www.linkedin.com/login",
  ]) {
    assert.deepEqual(normalizeLinkedinProfileKey(raw), { ok: false, reason: "not_a_profile" }, raw);
  }
  assert.equal(normalizeLinkedinProfileKey("https://www.linkedin.com/in/ana").ok, true);
  assert.equal(normalizeLinkedinProfileKey("https://www.linkedin.com/pub/ana/1/2/3").ok, true);
});

test("normalizeLinkedinProfileKey names the other rejection reasons and keeps the host check strict", () => {
  assert.deepEqual(normalizeLinkedinProfileKey("https://twitter.com/ana"), { ok: false, reason: "not_linkedin" });
  assert.deepEqual(normalizeLinkedinProfileKey("https://linkedin.com/"), { ok: false, reason: "unparseable" });
  assert.deepEqual(normalizeLinkedinProfileKey("https://linkedin.com"), { ok: false, reason: "unparseable" });
  for (const raw of [
    "https://notlinkedin.com/in/x",
    "https://linkedin.com.evil.net/in/x",
    "https://linkedin.com./in/x",
    "https://linkedin.com@evil.com/in/x",
  ]) {
    assert.deepEqual(normalizeLinkedinProfileKey(raw), { ok: false, reason: "not_linkedin" }, raw);
  }
});

test("null profileKey -> null href", () => {
  assert.equal(linkedinProfileHref(null), null);
});

test("re-adds https:// to a normalized profileKey", () => {
  assert.equal(linkedinProfileHref("linkedin.com/in/valentina-rojas"), "https://linkedin.com/in/valentina-rojas");
});
