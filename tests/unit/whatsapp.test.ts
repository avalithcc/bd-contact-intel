/**
 * Unit tests for src/lib/whatsapp.ts — the `wa.me` link builder. The number
 * rules (trunk 0, Argentine 15, length, extensions) belong to
 * libphonenumber-js; these tests pin what that means for the shapes the CRM
 * actually stores, so a library upgrade that changes one shows up here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { whatsappLink, whatsappLinkFor } from "@/lib/whatsapp";
import { safeWhatsappHref } from "@/lib/phone";

test("builds a wa.me link from the E.164 digits for numbers carrying a country code", () => {
  assert.equal(whatsappLinkFor("+54 9 11 5555-0142"), "https://wa.me/5491155550142");
  assert.equal(whatsappLinkFor("+34 612 345 678"), "https://wa.me/34612345678");
  assert.equal(whatsappLinkFor("+1 (305) 555-0182"), "https://wa.me/13055550182");
  assert.equal(whatsappLinkFor("  +1 (305) 555-0182 "), "https://wa.me/13055550182");
});

test("Mexican and Emirati numbers", () => {
  assert.equal(whatsappLinkFor("+52 55 5102 3344"), "https://wa.me/525551023344");
  assert.equal(whatsappLinkFor("+971 50 123 4567"), "https://wa.me/971501234567");
});

test("Argentine mobile written with '15' is converted to the '9' form WhatsApp opens", () => {
  assert.equal(whatsappLinkFor("+54 11 15 5555-0142"), "https://wa.me/5491155550142");
  assert.equal(whatsappLinkFor("+54 11 15-5555-0142"), "https://wa.me/5491155550142");
  assert.equal(whatsappLinkFor("+54 351 15 555-0187"), "https://wa.me/5493515550187");
  assert.equal(whatsappLinkFor("0054 11 15 5555-0142"), "https://wa.me/5491155550142");
});

test("Argentine '9' form and landlines are left alone", () => {
  assert.equal(whatsappLinkFor("+54 9 11 1555-0142"), "https://wa.me/5491115550142");
  assert.equal(whatsappLinkFor("+54 11 4123-4567"), "https://wa.me/541141234567");
});

test("a trunk 0 after the country code is dropped where the country drops it (Argentina, UK)", () => {
  assert.equal(whatsappLinkFor("+54 011 4123-4567"), "https://wa.me/541141234567");
  assert.equal(whatsappLinkFor("+44 020 7946 0958"), "https://wa.me/442079460958");
  assert.equal(whatsappLinkFor("+44 (0)20 7946 0958"), "https://wa.me/442079460958");
});

test("a leading 0 is kept where it is part of the number (Italy)", () => {
  assert.equal(whatsappLinkFor("+39 06 1234 5678"), "https://wa.me/390612345678");
});

test("the 00 international prefix is read as +", () => {
  assert.equal(whatsappLinkFor("00 54 9 11 5555-0142"), "https://wa.me/5491155550142");
  assert.equal(whatsappLinkFor("0054 11 4123-4567"), "https://wa.me/541141234567");
});

test("a glued extension makes the number invalid, so no link", () => {
  assert.deepEqual(whatsappLink("+54 11 4123-4567 214"), { url: null, reason: "unsupported" });
});

test("a doubled country code is rejected", () => {
  assert.deepEqual(whatsappLink("+54 54 11 4123-4567"), { url: null, reason: "unsupported" });
});

test("too short or too long to be a real number", () => {
  for (const v of ["+123456", "+12345678", "+1234567890123456", "+0 11 4123-4567"]) {
    assert.deepEqual(whatsappLink(v), { url: null, reason: "unsupported" }, v);
  }
});

test("no country code: no link, and no country is assumed", () => {
  assert.deepEqual(whatsappLink("011 4123-4567"), { url: null, reason: "no_country_code" });
  assert.deepEqual(whatsappLink("(011) 4123-4567"), { url: null, reason: "no_country_code" });
  assert.deepEqual(whatsappLink("4123-4567"), { url: null, reason: "no_country_code" });
  // Spanish and Italian numbers must not be read as Argentine ones.
  assert.deepEqual(whatsappLink("612 345 678"), { url: null, reason: "no_country_code" });
  assert.deepEqual(whatsappLink("06 1234 5678"), { url: null, reason: "no_country_code" });
});

test("malformed, blank and missing values are 'invalid'", () => {
  for (const v of ["5555-0142 cel.", "call me maybe", "+54 11 4123-4567 int. 214", "   ", "", null, undefined]) {
    assert.deepEqual(whatsappLink(v), { url: null, reason: "invalid" }, String(v));
  }
});

test("every link it builds passes the href guard", () => {
  for (const v of ["+54 11 15 5555-0142", "+44 020 7946 0958", "+39 06 1234 5678", "0054 11 4123-4567", "+971 50 123 4567"]) {
    const url = whatsappLinkFor(v);
    assert.equal(safeWhatsappHref(url), url, v);
  }
});

test("returns the url and no reason when a link can be built", () => {
  assert.deepEqual(whatsappLink("+54 9 11 5555-0142"), { url: "https://wa.me/5491155550142" });
});

test("whatsappLinkFor is whatsappLink's url for every reason", () => {
  assert.equal(whatsappLinkFor("011 4123-4567"), null);
  assert.equal(whatsappLinkFor("+123456"), null);
  assert.equal(whatsappLinkFor(null), null);
});

test("is pure: the same input gives the same result on repeated calls", () => {
  const input = "+54 11 15 5555-0142";
  assert.deepEqual(whatsappLink(input), whatsappLink(input));
  assert.equal(input, "+54 11 15 5555-0142");
});
