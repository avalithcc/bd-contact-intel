/**
 * The LinkedIn extension opens /contacts?new=1&linkedin=…&li_name=… with the basics read from the profile.
 * These pure helpers decide what reaches the "Nuevo contacto" form: the CRM's own name-splitting rules, a
 * city/country split that never guesses, and hard caps on every param.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { splitLocation } from "@/lib/contacts/locationSplit";
import { PREFILL_MAX_LENGTH, parseProfilePrefill } from "@/lib/contacts/linkedinProfilePrefill";
import { buildNewContactFields } from "@/lib/contacts/createContact";
import { linkedinPrefill } from "@/lib/contacts/linkedinCapture";
import { isKnownCountryName } from "@/lib/hiring/markets";

test("a trailing known country becomes the country and the rest the city", () => {
  assert.deepEqual(splitLocation("Buenos Aires, Argentina"), { city: "Buenos Aires", country: "Argentina" });
  assert.deepEqual(splitLocation("Ciudad de Buenos Aires, Buenos Aires, Argentina"), {
    city: "Ciudad de Buenos Aires, Buenos Aires",
    country: "Argentina",
  });
});

test("country matching ignores case and accents but keeps the text as written", () => {
  assert.deepEqual(splitLocation("Ciudad de México, MÉXICO"), { city: "Ciudad de México", country: "MÉXICO" });
  assert.equal(isKnownCountryName("Perú"), true);
  assert.equal(isKnownCountryName("Greater Buenos Aires"), false);
});

test("a location without a known country goes whole into the city", () => {
  assert.deepEqual(splitLocation("Greater Buenos Aires Metropolitan Area"), {
    city: "Greater Buenos Aires Metropolitan Area",
    country: null,
  });
  assert.deepEqual(splitLocation("Miami, Florida, Estados Unidos"), { city: "Miami, Florida, Estados Unidos", country: null });
});

test("a location that is only a country fills the country and leaves the city empty", () => {
  assert.deepEqual(splitLocation("Argentina"), { city: null, country: "Argentina" });
});

test("blank locations stay empty", () => {
  assert.deepEqual(splitLocation("   "), { city: null, country: null });
  assert.deepEqual(splitLocation(undefined), { city: null, country: null });
});

test("a stuffed suffix after a comma is dropped with the CRM name rule", () => {
  const prefill = parseProfilePrefill({ name: "Ana Pérez, MBA" });
  assert.equal(prefill?.firstName, "Ana");
  assert.equal(prefill?.lastName, "Pérez");
});

test("compound given names and middle initials follow the existing rule", () => {
  assert.deepEqual(
    [parseProfilePrefill({ name: "Maria Sol Gonzalez" })?.firstName, parseProfilePrefill({ name: "Maria Sol Gonzalez" })?.lastName],
    ["Maria Sol", "Gonzalez"],
  );
  assert.equal(parseProfilePrefill({ name: "Augusto D. Schultheis" })?.firstName, "Augusto D.");
});

test("the scrape artifact is cleaned before splitting", () => {
  const prefill = parseProfilePrefill({ name: "Camila HerreraVer el perfil de Camila Herrera" });
  assert.equal(prefill?.firstName, "Camila");
  assert.equal(prefill?.lastName, "Herrera");
});

test("a single-token or ambiguous name goes whole into the first name, never guessed", () => {
  assert.deepEqual(
    [parseProfilePrefill({ name: "Madonna" })?.firstName, parseProfilePrefill({ name: "Madonna" })?.lastName],
    ["Madonna", ""],
  );
  assert.deepEqual(
    [parseProfilePrefill({ name: "Ana J" })?.firstName, parseProfilePrefill({ name: "Ana J" })?.lastName],
    ["Ana J", ""],
  );
});

test("unreadable fields come back empty and nothing at all gives no prefill", () => {
  assert.equal(parseProfilePrefill({}), undefined);
  assert.equal(parseProfilePrefill({ name: "  ", title: "" }), undefined);
  const prefill = parseProfilePrefill({ name: "Ana Pérez", title: "Consultora independiente" });
  assert.equal(prefill?.company, "");
  assert.equal(prefill?.location, "");
  assert.equal(prefill?.jobTitle, "Consultora independiente");
});

test("every param is capped, control characters removed and whitespace collapsed", () => {
  const long = "x".repeat(PREFILL_MAX_LENGTH * 3);
  const prefill = parseProfilePrefill({ name: "Ana Pérez", title: long, company: "Des\u0000pe  gar\n", location: long });
  assert.equal(prefill?.jobTitle.length, PREFILL_MAX_LENGTH);
  assert.equal(prefill?.location.length, PREFILL_MAX_LENGTH);
  assert.equal(prefill?.company, "Des pe gar");
});

test("the create fields carry jobTitle, city and country with blank-to-null semantics", () => {
  const fields = buildNewContactFields({
    firstName: "Camila",
    lastName: "Herrera",
    linkedinUrl: "",
    email: "",
    company: "",
    jobTitle: " Directora de Producto ",
    location: "Buenos Aires, Argentina",
  });
  assert.equal(fields.jobTitle, "Directora de Producto");
  assert.equal(fields.city, "Buenos Aires");
  assert.equal(fields.country, "Argentina");
  const blank = buildNewContactFields({ firstName: "A", lastName: "", linkedinUrl: "", email: "", company: "" });
  assert.deepEqual([blank.jobTitle, blank.city, blank.country], [null, null, null]);
});

test("a repeated query param does not crash the page; the first value wins", () => {
  const prefill = parseProfilePrefill({ name: ["Ana Pérez", "x"], company: ["Acme"], title: [], location: undefined });
  assert.equal(prefill?.firstName, "Ana");
  assert.equal(prefill?.company, "Acme");
  assert.equal(prefill?.jobTitle, "");
  assert.equal(
    linkedinPrefill(["https://www.linkedin.com/in/ana-perez", "https://example.com"]),
    linkedinPrefill("https://www.linkedin.com/in/ana-perez"),
  );
});
