import assert from "node:assert/strict";
import { test } from "node:test";
import { localeForMessageLanguage } from "@/lib/outreach/messageLanguage";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { unsubscribePageAudience } from "@/lib/sequences/unsubscribePageAudience";
import { pageLocale, renderUnsubscribeHtml } from "@/lib/sequences/unsubscribeHtml";
import { handleUnsubscribeGetRequest, handleUnsubscribePostRequest, unsubscribeDocument } from "@/lib/sequences/unsubscribeRequest";
import type { UnsubscribePort, UnsubscribeView } from "@/lib/sequences/unsubscribeHandlers";
import { generateUnsubscribeToken } from "@/lib/sequences/unsubscribeToken";

// Expectations are LITERALS on purpose: a test that built them from t("es") could not catch a bad edit of the dictionary.

const TOKEN = generateUnsubscribeToken();
const EMAIL = "persona@example.test";
const ADDRESS = "Synthetic Co, 1 Test Street";
const confirm: UnsubscribeView = { kind: "confirm", email: EMAIL, token: TOKEN };
const done: UnsubscribeView = { kind: "done", email: EMAIL };

test("a Spanish audience gets the Spanish confirmation copy", () => {
  const html = renderUnsubscribeHtml(confirm, { postalAddress: ADDRESS, locale: "es" });
  assert.match(html, /<h3 class="center">¿Quieres darte de baja\?<\/h3>/);
  assert.match(html, /Dejaremos de escribir a persona@example\.test sobre capacidad de ingeniería\. Se aplica de inmediato\./);
  assert.match(html, /type="submit">Sí, darme de baja<\/button>/);
  assert.doesNotMatch(html, /Unsubscribe|Yes,/);
});

test("a Spanish audience gets the Spanish done copy", () => {
  const html = renderUnsubscribeHtml(done, { postalAddress: ADDRESS, locale: "es" });
  assert.match(html, /<h3>Te diste de baja<\/h3>/);
  assert.match(html, /No volveremos a escribir a persona@example\.test\. No necesitas hacer nada más\./);
});

test("an English audience still gets English", () => {
  const html = renderUnsubscribeHtml(confirm, { postalAddress: ADDRESS, locale: "en" });
  assert.match(html, /<h3 class="center">Unsubscribe\?<\/h3>/);
  assert.match(html, /type="submit">Yes, unsubscribe me<\/button>/);
});

test("the invalid page is English and carries no address, whatever the audience", () => {
  const html = renderUnsubscribeHtml({ kind: "invalid" });
  assert.match(html, /This link is no longer valid/);
  assert.doesNotMatch(html, /help center mt-md/);
});

test("the invalid page stays English even if handed a Spanish audience (no token, no language signal)", () => {
  const html = renderUnsubscribeHtml({ kind: "invalid" }, { postalAddress: ADDRESS, locale: "es" });
  assert.match(html, /<h3>This link is no longer valid<\/h3>/);
  assert.doesNotMatch(html, /help center mt-md|válido/);
  assert.equal(pageLocale({ kind: "invalid" }, { locale: "es" }), "en");
});

test("the document declares the page language", () => {
  assert.match(unsubscribeDocument("<p>x</p>", "", "es"), /<html lang="es">/);
  assert.match(unsubscribeDocument("<p>x</p>", "", "en"), /<html lang="en">/);
});

test("address and language are independent: Argentina is mdp+es, Mexico miami+es, Spain/Ireland miami+en", () => {
  const cases = [
    { country: "Argentina", address: "mdp", locale: "es" },
    { country: "Mexico", address: "miami", locale: "es" },
    { country: "Spain", address: "miami", locale: "es" },
    { country: "Ireland", address: "miami", locale: "en" },
  ] as const;
  for (const c of cases) {
    const page = unsubscribePageAudience({ mobilePhone: null, phone: null, personCountry: c.country });
    assert.ok(page, c.country);
    assert.equal(page.locale, c.locale, c.country);
    const expected = COMPLIANCE_CONFIG[c.address]?.postalAddress;
    assert.ok(expected, c.address);
    assert.equal(page.postalAddress, expected, c.country);
    const html = renderUnsubscribeHtml(done, page);
    assert.ok(html.includes(expected.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)), c.country);
  }
});

test("MessageLanguage narrows to a page locale totally: pt is English by the owner's choice", () => {
  assert.equal(localeForMessageLanguage("es"), "es");
  assert.equal(localeForMessageLanguage("en"), "en");
  assert.equal(localeForMessageLanguage("pt"), "en");
});

function requestDeps(locale: "es" | "en") {
  const port: UnsubscribePort = {
    findToken: async () => ({ email: EMAIL }),
    suppressByToken: async () => ({ email: EMAIL }),
  };
  return {
    port,
    audienceFor: async () => ({ postalAddress: ADDRESS, locale }),
    render: (view: UnsubscribeView, page?: { postalAddress?: string; locale: "es" | "en" }) =>
      unsubscribeDocument(renderUnsubscribeHtml(view, page), "", page?.locale ?? "en"),
  };
}

test("GET and POST both render in the token's language, document language included", async () => {
  const got = await handleUnsubscribeGetRequest(new Request(`https://example.test/api/unsubscribe?t=${TOKEN}`), requestDeps("es"));
  const gotHtml = await got.text();
  assert.match(gotHtml, /<html lang="es">/);
  assert.match(gotHtml, /Sí, darme de baja/);
  const posted = await handleUnsubscribePostRequest(
    new Request(`https://example.test/api/unsubscribe?t=${TOKEN}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }),
    requestDeps("es"),
  );
  const postedHtml = await posted.text();
  assert.match(postedHtml, /<html lang="es">/);
  assert.match(postedHtml, /Te diste de baja/);
});

test("an invalid token is English with lang=en and never asks for an audience", async () => {
  let asked = 0;
  const deps = { ...requestDeps("es"), audienceFor: async () => (asked++, undefined) };
  const res = await handleUnsubscribeGetRequest(new Request("https://example.test/api/unsubscribe?t=short"), deps);
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /This link is no longer valid/);
  assert.equal(asked, 0);
});
