/**
 * Unit tests for src/lib/phone.ts — pure phone display/validation helper
 * behind the contact record's "Teléfono"/"Móvil" properties (contact-record
 * mockup: tel: links with inline edit).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidPhoneFormat, toTelHref, formatPhoneForDisplay, pickListPhone, whatsappLink, whatsappLinkFor } from "@/lib/phone";

test("a value with only digits, spaces, dashes, parens and a leading + is valid", () => {
  assert.equal(isValidPhoneFormat("+54 11 4123-4567"), true);
  assert.equal(isValidPhoneFormat("(011) 4123-4567"), true);
  assert.equal(isValidPhoneFormat("011-4123-4567"), true);
  assert.equal(isValidPhoneFormat("+1 305 555 0182"), true);
});

test("too few digits is invalid", () => {
  assert.equal(isValidPhoneFormat("123"), false);
});

test("letters make it invalid", () => {
  assert.equal(isValidPhoneFormat("call me maybe"), false);
});

test("a + anywhere but the start is invalid", () => {
  assert.equal(isValidPhoneFormat("54+1141234567"), false);
});

test("blank is invalid", () => {
  assert.equal(isValidPhoneFormat("  "), false);
});

test("toTelHref strips spaces/dashes/parens and keeps a leading +", () => {
  assert.equal(toTelHref("+54 11 4123-4567"), "tel:+541141234567");
  assert.equal(toTelHref("(011) 4123-4567"), "tel:01141234567");
});

test("toTelHref returns null for an invalid value", () => {
  assert.equal(toTelHref("call me maybe"), null);
});

test("formatPhoneForDisplay trims but otherwise preserves the entered format", () => {
  assert.equal(formatPhoneForDisplay("  +54 11 4123-4567  "), "+54 11 4123-4567");
});

test("pickListPhone prefers phone, falls back to mobilePhone, and skips blank values", () => {
  assert.equal(pickListPhone("+54 11 4123-4567", "+54 9 11 5555-0000"), "+54 11 4123-4567");
  assert.equal(pickListPhone(null, " +54 9 11 5555-0000 "), "+54 9 11 5555-0000");
  assert.equal(pickListPhone("+1000", null), "+1000");
  assert.equal(pickListPhone("   ", "+54 9 11 5555-0000"), "+54 9 11 5555-0000");
  assert.equal(pickListPhone(null, null), null);
  assert.equal(pickListPhone("", "  "), null);
});

test("pickListPhone keeps a malformed value so the cell agrees with the hasPhone filter", () => {
  assert.equal(pickListPhone("ext 12", null), "ext 12");
});

// --- whatsappLinkFor (contact-whatsapp-access, variant A) -------------------

test("whatsappLinkFor builds a wa.me link with digits only for numbers carrying a country code", () => {
  assert.equal(whatsappLinkFor("+54 9 11 5555-0142"), "https://wa.me/5491155550142");
  assert.equal(whatsappLinkFor("+52 55 5102 3344"), "https://wa.me/525551023344");
  assert.equal(whatsappLinkFor("+971 50 123 4567"), "https://wa.me/971501234567");
});

test("whatsappLinkFor strips parentheses, dashes and surrounding whitespace", () => {
  assert.equal(whatsappLinkFor("  +1 (305) 555-0182 "), "https://wa.me/13055550182");
});

test("whatsappLinkFor accepts the 00 international prefix and ignores the leading zeros", () => {
  assert.equal(whatsappLinkFor("00 54 9 11 5555-0142"), "https://wa.me/5491155550142");
  assert.equal(whatsappLinkFor("0054 11 4123-4567"), "https://wa.me/541141234567");
});

test("whatsappLinkFor returns null without a country code (no guessing the country)", () => {
  assert.equal(whatsappLinkFor("011 4123-4567"), null);
  assert.equal(whatsappLinkFor("(011) 4123-4567"), null);
  assert.equal(whatsappLinkFor("4123-4567"), null);
});

test("whatsappLinkFor returns null for malformed, blank and missing values", () => {
  assert.equal(whatsappLinkFor("5555-0142 cel."), null);
  assert.equal(whatsappLinkFor("+54 11 4123-4567 int. 214"), null);
  assert.equal(whatsappLinkFor("call me maybe"), null);
  assert.equal(whatsappLinkFor("+123"), null);
  assert.equal(whatsappLinkFor("   "), null);
  assert.equal(whatsappLinkFor(""), null);
  assert.equal(whatsappLinkFor(null), null);
  assert.equal(whatsappLinkFor(undefined), null);
});

test("whatsappLinkFor returns null when the digits cannot be a real international number", () => {
  // E.164 allows at most 15 digits.
  assert.equal(whatsappLinkFor("+1234567890123456"), null);
  // No country code starts with 0.
  assert.equal(whatsappLinkFor("+0 11 4123-4567"), null);
  assert.equal(whatsappLinkFor("000 11 4123-4567"), null);
  // A bare 00 prefix with nothing usable after it.
  assert.equal(whatsappLinkFor("00"), null);
});

test("whatsappLinkFor refuses a '(0)' trunk digit it would have to drop by guessing", () => {
  assert.equal(whatsappLinkFor("+44 (0)20 7946 0958"), null);
});

// --- whatsappLink: the reason a link cannot be built -------------------------

test("whatsappLink returns the url and no reason when a link can be built", () => {
  assert.deepEqual(whatsappLink("+54 9 11 5555-0142"), { url: "https://wa.me/5491155550142" });
});

test("whatsappLink reports 'no_country_code' only for a valid number with no + or 00 prefix", () => {
  assert.deepEqual(whatsappLink("011 4123-4567"), { url: null, reason: "no_country_code" });
  assert.deepEqual(whatsappLink("4123-4567"), { url: null, reason: "no_country_code" });
});

test("whatsappLink reports 'invalid' for blank, missing and malformed values", () => {
  for (const v of ["", "   ", null, undefined, "5555-0142 cel.", "call me maybe"]) {
    assert.deepEqual(whatsappLink(v), { url: null, reason: "invalid" }, String(v));
  }
});

test("whatsappLink reports 'unsupported' for numbers that DO carry a country code but cannot be linked safely", () => {
  for (const v of ["+44 (0)20 7946 0958", "+1234567890123456", "+0 11 4123-4567", "+123456", "00 0 11 4123 4567", "+54 11 15 5555-0142"]) {
    assert.deepEqual(whatsappLink(v), { url: null, reason: "unsupported" }, v);
  }
});

// --- minimum length for a link (the tel: link keeps the 6-digit floor) -------

test("whatsappLinkFor needs at least 8 digits, country code included; tel: keeps the 6-digit floor", () => {
  assert.equal(whatsappLinkFor("+123456"), null);
  assert.equal(whatsappLinkFor("+1234567"), null);
  assert.equal(whatsappLinkFor("+12345678"), "https://wa.me/12345678");
  assert.equal(toTelHref("+123456"), "tel:+123456");
});

// --- Argentine mobiles written with the old "15" prefix ----------------------

test("whatsappLinkFor refuses an Argentine number written with the mobile '15' prefix instead of converting it", () => {
  // The WhatsApp-correct form is "+54 9 <area> <number>"; "15" and "9" are mutually exclusive.
  assert.equal(whatsappLinkFor("+54 11 15 5555-0142"), null);
  assert.equal(whatsappLinkFor("+54 11 15-5555-0142"), null);
  assert.equal(whatsappLinkFor("+54 351 15 555-0187"), null);
  assert.equal(whatsappLinkFor("+54 2966 15 42-1234"), null);
  assert.equal(whatsappLinkFor("0054 11 15 5555-0142"), null);
});

test("whatsappLinkFor still links Argentine numbers where '15' is not the mobile prefix", () => {
  assert.equal(whatsappLinkFor("+54 11 4123-1500"), "https://wa.me/541141231500");
  assert.equal(whatsappLinkFor("+54 351 415-1234"), "https://wa.me/543514151234");
  assert.equal(whatsappLinkFor("+54 9 11 5555-0142"), "https://wa.me/5491155550142");
  assert.equal(whatsappLinkFor("+54 9 11 1555-0142"), "https://wa.me/5491115550142");
  // Another country with "15" in the same position is untouched.
  assert.equal(whatsappLinkFor("+52 55 1512 3344"), "https://wa.me/525515123344");
});

// --- KNOWN LIMITS: these build a WRONG link today -----------------------------
// Pinned on purpose. None can be told apart from a correct number without a
// real parser (country metadata); the day one is added, this block is what
// changes. Do not "fix" them with ad hoc rules.

test("KNOWN LIMIT: a glued extension is read as part of the number", () => {
  // "+54 11 4123-4567 214": the 214 cannot be told from subscriber digits.
  assert.equal(whatsappLinkFor("+54 11 4123-4567 214"), "https://wa.me/541141234567214");
});

test("KNOWN LIMIT: a trunk 0 written without the (0) marker is kept", () => {
  // Argentina and the UK drop it after the country code; Italy keeps it, so no blanket rule exists.
  assert.equal(whatsappLinkFor("+54 011 4123-4567"), "https://wa.me/5401141234567");
  assert.equal(whatsappLinkFor("+44 020 7946 0958"), "https://wa.me/4402079460958");
  assert.equal(whatsappLinkFor("+39 06 1234 5678"), "https://wa.me/390612345678"); // correct: Italy keeps the 0
});

test("KNOWN LIMIT: only '+' and '00' are recognised as an international exit code", () => {
  // Australia's 0011, the US/Canada 011 and others are indistinguishable from a domestic prefix.
  assert.equal(whatsappLinkFor("0011 61 2 1234 5678"), "https://wa.me/1161212345678");
  assert.equal(whatsappLinkFor("011 54 11 4123-4567"), null);
});

test("KNOWN LIMIT: a doubled country code is not detected", () => {
  assert.equal(whatsappLinkFor("+54 54 11 4123-4567"), "https://wa.me/54541141234567");
});
