/**
 * Unit tests for src/lib/phone.ts — pure phone display/validation helper
 * behind the contact record's "Teléfono"/"Móvil" properties (contact-record
 * mockup: tel: links with inline edit).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidPhoneFormat, toTelHref, formatPhoneForDisplay, pickListPhone } from "@/lib/phone";

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
