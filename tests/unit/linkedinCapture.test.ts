/**
 * Unit tests for src/lib/contacts/linkedinCapture.ts (the /capture/linkedin
 * route's decisions) and src/lib/contacts/linkedinBookmarklet.ts. The bookmarklet
 * only ever sends a URL, so every decision here is made from that URL alone.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { captureRedirectPath, isCaptureNextPath, isFromLinkedin, linkedinPrefill, noticeOwnerVariant, parseCaptureUrl } from "@/lib/contacts/linkedinCapture";
import { buildBookmarkletHref, resolveAppOrigin } from "@/lib/contacts/linkedinBookmarklet";
import { sanitizeNextPath } from "@/lib/auth/nextPath";

test("a person profile URL becomes the same profile_key the importers write", () => {
  const r = parseCaptureUrl("https://www.linkedin.com/in/Camila-Herrera-12ab/?utm_source=share#x");
  assert.deepEqual(r, {
    ok: true,
    profileKey: "linkedin.com/in/camila-herrera-12ab",
    linkedinUrl: "https://linkedin.com/in/camila-herrera-12ab",
  });
});

test("blank or absent input is 'missing', with nothing to show", () => {
  for (const raw of [undefined, null, "", "   "]) {
    assert.deepEqual(parseCaptureUrl(raw), { ok: false, reason: "missing", received: null });
  }
});

test("a company page is told apart from a general LinkedIn page", () => {
  assert.deepEqual(parseCaptureUrl("https://www.linkedin.com/company/mercado-libre/"), {
    ok: false,
    reason: "company",
    received: "linkedin.com/company/mercado-libre/",
  });
  for (const raw of ["https://www.linkedin.com/feed/", "https://www.linkedin.com/search/results/people/?keywords=a", "https://www.linkedin.com/messaging/", "https://www.linkedin.com/"]) {
    const r = parseCaptureUrl(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(!r.ok && r.reason, "general", raw);
  }
});

test("another site, or text that is not a URL, is 'not_linkedin'", () => {
  for (const raw of ["https://mail.google.com/mail/u/0/#inbox", "https://notlinkedin.com/in/ana", "https://linkedin.com.evil.test/in/ana", "hola mundo"]) {
    const r = parseCaptureUrl(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(!r.ok && r.reason, "not_linkedin", raw);
  }
});

test("the received text shown back is bounded and carries no query string", () => {
  const r = parseCaptureUrl(`https://example.com/${"a".repeat(500)}?token=secret`);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.received!.length <= 120);
    assert.ok(!r.received!.includes("secret"));
  }
});

test("a live person sends the BD to the record with ?from=linkedin", () => {
  const input = { profileKey: "linkedin.com/in/x", linkedinUrl: "https://linkedin.com/in/x" };
  assert.equal(captureRedirectPath(input, "8f3c1111-2222-3333-4444-555566667777"), "/contacts/8f3c1111-2222-3333-4444-555566667777?from=linkedin");
});

test("nobody found opens the new-contact dialog with the encoded URL", () => {
  const input = { profileKey: "linkedin.com/in/x", linkedinUrl: "https://linkedin.com/in/x" };
  assert.equal(captureRedirectPath(input, null), "/contacts?new=1&linkedin=https%3A%2F%2Flinkedin.com%2Fin%2Fx");
});

test("the bookmarklet reads only location.href and opens the app origin", () => {
  const href = buildBookmarkletHref("https://crm.avalith.net");
  assert.ok(href.startsWith("javascript:"));
  assert.ok(href.includes("https://crm.avalith.net/capture/linkedin?url="));
  assert.ok(href.includes("encodeURIComponent(location.href)"));
  assert.ok(!/document\.|innerHTML|fetch|XMLHttpRequest/.test(href), "must not read the page or call out");
});

test("the app origin comes from the request host, else the configured site URL", () => {
  assert.equal(resolveAppOrigin({ host: "crm.avalith.net", forwardedProto: "https" }, "https://fallback.test"), "https://crm.avalith.net");
  assert.equal(resolveAppOrigin({ host: "localhost:3000", forwardedProto: null }, "https://fallback.test"), "http://localhost:3000");
  assert.equal(resolveAppOrigin({ host: null, forwardedProto: null }, "https://fallback.test"), "https://fallback.test");
  assert.equal(resolveAppOrigin({ host: "evil.com/x y", forwardedProto: "https" }, "https://fallback.test"), "https://fallback.test");
});

test("/capture/linkedin?url=… survives the login ?next= round trip", () => {
  const requested = "/capture/linkedin?url=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fana-paz%2F%3Futm%3D1";
  const params = new URLSearchParams();
  params.set("next", requested); // what the middleware does
  const next = new URLSearchParams(params.toString()).get("next"); // what the login page reads
  assert.equal(sanitizeNextPath(next), requested);
});

test("the notice names the owner, or says it is yours, or says nobody owns it", () => {
  assert.equal(noticeOwnerVariant("bd-1", "Ana Pereyra", "bd-1"), "mine");
  assert.equal(noticeOwnerVariant("bd-2", "Ana Pereyra", "bd-1"), "other");
  assert.equal(noticeOwnerVariant(null, null, "bd-1"), "none");
  assert.equal(noticeOwnerVariant("bd-2", null, "bd-1"), "none");
});

test("only ?from=linkedin shows the notice", () => {
  assert.equal(isFromLinkedin("linkedin"), true);
  for (const v of [undefined, "", "Linkedin", "gmail"]) assert.equal(isFromLinkedin(v), false);
});

test("the dialog pre-fill is re-validated: a non-profile ?linkedin= is dropped", () => {
  assert.equal(linkedinPrefill("https://www.linkedin.com/in/ana-paz/?x=1"), "https://linkedin.com/in/ana-paz");
  assert.equal(linkedinPrefill("https://www.linkedin.com/company/acme"), undefined);
  assert.equal(linkedinPrefill("javascript:alert(1)"), undefined);
  assert.equal(linkedinPrefill(undefined), undefined);
});

test("the login hint shows only when the sanitized next points at the capture route", () => {
  assert.equal(isCaptureNextPath("/capture/linkedin?url=https%3A%2F%2Flinkedin.com%2Fin%2Fx"), true);
  assert.equal(isCaptureNextPath("/capture/linkedin"), true);
  for (const v of ["/", "/contacts", "/capture/linkedinx", "/x/capture/linkedin"]) assert.equal(isCaptureNextPath(v), false, v);
});
