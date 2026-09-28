/**
 * Unit tests for src/lib/contacts/locationDisplay.ts (mockup-port fix;
 * contact-record.html:86's single "Ubicación" row — "Buenos Aires,
 * Argentina" composed from city + country; region is never shown).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { composeLocation } from "@/lib/contacts/locationDisplay";

test("composes 'City, Country' when both are present", () => {
  assert.equal(composeLocation("Buenos Aires", "Argentina"), "Buenos Aires, Argentina");
});

test("returns just the city when country is missing, no dangling comma", () => {
  assert.equal(composeLocation("Buenos Aires", null), "Buenos Aires");
});

test("returns just the country when city is missing, no leading comma", () => {
  assert.equal(composeLocation(null, "Argentina"), "Argentina");
});

test("returns null when both are missing (caller renders the empty-value dash)", () => {
  assert.equal(composeLocation(null, null), null);
});

test("treats blank strings the same as missing", () => {
  assert.equal(composeLocation("  ", "Argentina"), "Argentina");
  assert.equal(composeLocation("Buenos Aires", "  "), "Buenos Aires");
});
