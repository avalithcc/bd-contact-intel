/**
 * Unit tests for src/lib/phone.ts — pure phone display/validation helper
 * behind the contact record's "Teléfono"/"Móvil" properties (contact-record
 * mockup: tel: links with inline edit).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidPhoneFormat, toTelHref, formatPhoneForDisplay, pickListPhone, whatsappLinkFor } from "@/lib/phone";

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
