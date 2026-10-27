import assert from "node:assert/strict";
import { test } from "node:test";
import { localeForMessageLanguage } from "@/lib/outreach/messageLanguage";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import { unsubscribePageAudience } from "@/lib/sequences/unsubscribePageAudience";
import { pageLocale, renderUnsubscribeHtml } from "@/lib/sequences/unsubscribeHtml";
import { handleUnsubscribeGetRequest, handleUnsubscribePostRequest, renderUnsubscribePage, unsubscribeDocument, type UnsubscribeRequestDeps } from "@/lib/sequences/unsubscribeRequest";
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
    const page = unsubscribePageAudience({ mobilePhone: null, phone: null, rosterCountries: [], personCountry: c.country });
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

function requestDeps(locale: "es" | "en", audienceFor: UnsubscribeRequestDeps["audienceFor"] = async () => ({ postalAddress: ADDRESS, locale })): UnsubscribeRequestDeps {
  const port: UnsubscribePort = {
    findToken: async () => ({ email: EMAIL }),
    suppressByToken: async () => ({ email: EMAIL }),
  };
  // The production wiring (route.ts) is exactly this: the page function with the stylesheet.
  return { port, audienceFor, render: (view, page) => renderUnsubscribePage(view, page, "") };
}

const getPage = (query: string, deps: UnsubscribeRequestDeps) => handleUnsubscribeGetRequest(new Request(`https://example.test/api/unsubscribe${query}`), deps);
const postPage = (deps: UnsubscribeRequestDeps) =>
  handleUnsubscribePostRequest(
    new Request(`https://example.test/api/unsubscribe?t=${TOKEN}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }),
    deps,
  );

test("GET and POST both render in the token's language, document language included", async () => {
  const gotHtml = await (await getPage(`?t=${TOKEN}`, requestDeps("es"))).text();
  assert.match(gotHtml, /<html lang="es">/);
  assert.match(gotHtml, /Sí, darme de baja/);
  const postedHtml = await (await postPage(requestDeps("es"))).text();
  assert.match(postedHtml, /<html lang="es">/);
  assert.match(postedHtml, /Te diste de baja/);
});

test("an English audience: lang=en and English copy on both screens", async () => {
  const gotHtml = await (await getPage(`?t=${TOKEN}`, requestDeps("en"))).text();
  assert.match(gotHtml, /<html lang="en">/);
  assert.match(gotHtml, /Yes, unsubscribe me/);
  const postedHtml = await (await postPage(requestDeps("en"))).text();
  assert.match(postedHtml, /<html lang="en">/);
  assert.match(postedHtml, /You&#39;re unsubscribed|You're unsubscribed/);
});

test("an invalid token is English with lang=en, 404, no address, and never asks for an audience", async () => {
  let asked = 0;
  const res = await getPage("?t=short", requestDeps("es", async () => (asked++, { postalAddress: ADDRESS, locale: "es" })));
  const html = await res.text();
  assert.equal(res.status, 404);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /This link is no longer valid/);
  assert.doesNotMatch(html, /help center mt-md|válido/);
  assert.equal(asked, 0);
});

test("Mexico through the full wiring: Miami address with Spanish copy and lang=es", async () => {
  const mexico = unsubscribePageAudience({ mobilePhone: null, phone: null, rosterCountries: [], personCountry: "Mexico" });
  assert.ok(mexico);
  const html = await (await getPage(`?t=${TOKEN}`, requestDeps("es", async () => mexico))).text();
  const miami = COMPLIANCE_CONFIG.miami?.postalAddress;
  assert.ok(miami);
  assert.match(html, /<html lang="es">/);
  assert.match(html, /Sí, darme de baja/);
  assert.ok(html.includes(miami.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)));
});

// The recorded language choice (sequence_member.draft_language) decides the page's language; the audience decides the address.
const usCompany = { mobilePhone: null, phone: null, rosterCountries: [], personCountry: null, companyCountry: "United States" } as const;
const usAddress = unsubscribePageAudience(usCompany)?.postalAddress;

test("a chosen language that differs from the audience wins for the locale, and the address stays the audience's (production case)", () => {
  assert.equal(unsubscribePageAudience(usCompany)?.locale, "en");
  assert.ok(usAddress);
  const page = unsubscribePageAudience(usCompany, { chosen: "es" });
  assert.deepEqual(page, { postalAddress: usAddress, locale: "es" });
  const html = renderUnsubscribeHtml(confirm, page);
  assert.match(html, /Sí, darme de baja/);
  assert.ok(html.includes(usAddress.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)));
});

test("nobody chose (null or undefined): the audience language still applies", () => {
  const argentina = { mobilePhone: null, phone: null, rosterCountries: [], personCountry: "Argentina" } as const;
  assert.equal(unsubscribePageAudience(argentina, { chosen: null })?.locale, "es");
  assert.equal(unsubscribePageAudience(argentina)?.locale, "es");
  assert.equal(unsubscribePageAudience(usCompany, { chosen: null })?.locale, "en");
});

test("a chosen language with no audience gives that locale and no address", () => {
  const none = { mobilePhone: null, phone: null, rosterCountries: [], personCountry: null } as const;
  assert.equal(unsubscribePageAudience(none), undefined);
  assert.deepEqual(unsubscribePageAudience(none, { chosen: "es" }), { locale: "es" });
  assert.deepEqual(unsubscribePageAudience(none, { chosen: "en" }), { locale: "en" });
  assert.doesNotMatch(renderUnsubscribeHtml(done, unsubscribePageAudience(none, { chosen: "es" })), /help center mt-md/);
});

test("a stored value that is not es/en reads as no choice: the audience language applies", () => {
  for (const garbage of ["pt", "ES", "", " es", "fr", 3, {}]) {
    assert.deepEqual(unsubscribePageAudience(usCompany, { chosen: garbage }), unsubscribePageAudience(usCompany), String(garbage));
  }
  assert.equal(unsubscribePageAudience({ mobilePhone: null, phone: null, rosterCountries: [], personCountry: null }, { chosen: "pt" }), undefined);
});

test("a language choice never changes the postal address", () => {
  for (const country of ["Argentina", "Mexico", "Spain", "Ireland", "United States"]) {
    const input = { mobilePhone: null, phone: null, rosterCountries: [], personCountry: country } as const;
    const base = unsubscribePageAudience(input)?.postalAddress;
    for (const choice of ["es", "en", null, "garbage"]) {
      assert.equal(unsubscribePageAudience(input, { chosen: choice })?.postalAddress, base, `${country}/${choice}`);
      assert.equal(unsubscribePageAudience(input, { preferred: choice })?.postalAddress, base, `${country}/preferred ${choice}`);
    }
  }
});
