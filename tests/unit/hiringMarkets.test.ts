import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMarket, isMiamiArea, isOffshoreHub } from "@/lib/hiring/markets";

// Counts below were measured against production on 2026-10-21 (15,810
// job_posting rows). Before this module had a unit test, bare tokens and
// substring phrases that collide with foreign text went unnoticed.

test("bare 'in' no longer files India, the preposition, or 'In-Office' as us (239 rows, 70 open IT, 50 fresh IT)", () => {
  for (const location of ["Bengaluru, IN", "IN-Bangalore-MSO", "Chennai, in", "In-Office", "Anywhere in France"]) {
    assert.notEqual(classifyMarket(location), "us", location);
    assert.notEqual(classifyMarket(location), "latam", location);
  }
});

test("bare 'de' no longer files Germany, French compounds or Spanish particles as us (113 rows, 8 open IT, 3 fresh IT)", () => {
  for (const location of ["Berlin, DE", "Cologne, de", "Pas-de-Calais", "Hauts-de-France", "Rio de Janeiro", "Cuajimalpa de Morelos"]) {
    assert.notEqual(classifyMarket(location), "us", location);
  }
});

test("bare 'id' no longer files Indonesia as us (14 rows, all Indonesia)", () => {
  assert.notEqual(classifyMarket("Jakarta, ID"), "us");
  assert.notEqual(classifyMarket("Jakarta, ID"), "latam");
});

test("'usa' is a token, so it no longer matches inside Lausanne, Busan, Jerusalem, Cusano (7 rows)", () => {
  for (const location of ["Lausanne, Switzerland", "Busan, South Korea", "Jerusalem, Israel", "Cusano Milanino, IT"]) {
    assert.equal(classifyMarket(location), "other", location);
  }
});

test("'usa' as a whole word still classifies us", () => {
  assert.equal(classifyMarket("Denver, USA"), "us");
  assert.equal(classifyMarket("Remote - USA"), "us");
});

test("'lima' is a token, so it no longer matches inside Limassol (11 rows)", () => {
  assert.equal(classifyMarket("Limassol, Cyprus"), "other");
  assert.equal(classifyMarket("Lima"), "latam");
});

test("San Jose with no Costa Rica signal is no longer latam (42 sole rows, 37 say California)", () => {
  assert.equal(classifyMarket("San Jose, CA"), "us");
  assert.equal(classifyMarket("San Jose, California"), "us");
  assert.equal(classifyMarket("San Jose"), "other");
});

test("real state and country spellings keep working after the token removals", () => {
  assert.equal(classifyMarket("Indianapolis, IN"), "us");
  assert.equal(classifyMarket("Wilmington, Delaware"), "us");
  assert.equal(classifyMarket("Boise, Idaho"), "us");
  assert.equal(classifyMarket("San Jose, Costa Rica"), "latam");
  assert.equal(classifyMarket("San Jose, CR"), "latam");
  assert.equal(classifyMarket("Lima, Peru"), "latam");
  assert.equal(classifyMarket("Brasilia"), "latam");
  assert.equal(classifyMarket("Miami, FL"), "us");
});

test("moving 'miami' from a phrase to a token does not change classifyMarket", () => {
  assert.equal(classifyMarket("Miami"), "us");
  assert.equal(classifyMarket("Miami-Dade, FL"), "us");
  assert.equal(classifyMarket("Miamisburg, OH, us"), "us");
});

test("isMiamiArea: Miamisburg, Ohio is not Florida (27 rows were stored is_miami = true)", () => {
  assert.equal(isMiamiArea("Miamisburg, OH, us"), false);
  assert.equal(isMiamiArea("Miami, FL"), true);
  assert.equal(isMiamiArea("Miami-Dade, FL"), true);
  assert.equal(isMiamiArea("Orlando, FL"), true);
});

// Without an "FL" suffix these strings have no other Florida signal, so they
// exercise the 'miami' TOKEN itself. The suffixed cases above also match the
// 'fl' token, which would mask a regression in the token move.
test("isMiamiArea: the 'miami' token matches on its own, with no FL suffix to lean on", () => {
  assert.equal(isMiamiArea("Miami-Dade"), true);
  assert.equal(isMiamiArea("Miami Beach"), true);
  assert.equal(isMiamiArea("North Miami"), true);
  assert.equal(isMiamiArea("Miami/Fort Lauderdale"), true);
  assert.equal(isMiamiArea("Miami, Florida"), true);
});

test("isOffshoreHub is untouched by the market constants change", () => {
  assert.equal(isOffshoreHub("Bengaluru, IN"), true);
  assert.equal(isOffshoreHub("Chennai, in"), true);
  assert.equal(isOffshoreHub("Indianapolis, IN"), false);
});

// Accepted cost of removing the bare 'in' token: the measured Indiana rows
// that relied on it (Lafayette x2, Evansville x1 = 3 rows, 0 open IT, 0 fresh
// IT) now classify as other. Pinned so the trade-off stays visible. The full
// name "Indiana" and any city containing it (Indianapolis) still match.
test("accepted cost: Indiana cities written with a bare 'IN' classify as other (3 rows, none live)", () => {
  assert.equal(classifyMarket("Lafayette, IN"), "other");
  assert.equal(classifyMarket("Evansville, IN"), "other");
});

// Same trade for 'de' and 'id'. Production had ZERO Delaware and ZERO Idaho
// rows relying on these tokens, against 113 wrong rows for 'de' (Germany,
// French compounds, Spanish particles) and 14 for 'id' (all Indonesia). But a
// US feed emitting the postal code rather than the state name is plausible, so
// the cost is pinned rather than left implied by a "zero rows" comment. The
// state spellings "Delaware" and "Idaho" still match (see the test above).
test("accepted cost: Delaware and Idaho cities written with a bare postal code classify as other", () => {
  for (const location of ["Wilmington, DE", "Dover, DE", "Newark, DE"]) {
    assert.equal(classifyMarket(location), "other", location);
  }
  for (const location of ["Boise, ID", "Meridian, ID"]) {
    assert.equal(classifyMarket(location), "other", location);
  }
});

// Accepted cost of deleting the 'san jose' phrase. It normalized the accent
// away, so the Spanish spelling matched too and filed latam. Production had 3
// bare "San Jose" rows, none live, and ZERO live Costa Rica rows overall — but
// a Costa Rican ATS emitting only the city is plausible, so this is recorded as
// a knowing loss. Any Costa Rica signal still resolves it (see the test above).
test("accepted cost: a bare 'San José' with no country signal classifies as other", () => {
  assert.equal(classifyMarket("San José"), "other");
  assert.equal(classifyMarket("San José, SJ"), "other");
  assert.equal(classifyMarket("San José, Costa Rica"), "latam");
});

// The precedence fix of 2026-10-27 (country signal beats a bare 2-letter code). Every string below is a real
// production location. Before it, LATAM rules ran first and returned, so "co"/"pa"/"ar" filed plainly-US text
// latam (182 rows, 40 open IT, 29 fresh IT) and "ca"/"tn"/"il"/"md"/"ct" filed Canada, India, Israel and Spain us.
test("an explicit country beats a bare co/pa/ar: plainly-US text is us", () => {
  for (const location of [
    "Colorado Springs, CO, United States",
    "Denver, CO, USA",
    "Denver, CO, us",
    "Philadelphia, PA, United States",
    "Little Rock, AR, us",
    "Bensalem Township, PA, us",
    "US-CO-Denver",
    "US-PA-Remote",
  ]) {
    assert.equal(classifyMarket(location), "us", location);
  }
});

test("a named US place beats a bare co/pa/ar even with no country (Denver, Philadelphia, Colorado Springs)", () => {
  for (const location of ["Denver, CO - Hybrid", "Philadelphia, PA", "Colorado Springs, CO", "Denver, CO"]) {
    assert.equal(classifyMarket(location), "us", location);
  }
});

test("a named LATAM place or a LATAM country still files latam with the same codes", () => {
  for (const location of ["Bogotá, CO", "Medellín, CO", "Buenos Aires, AR", "Medellín, Antioquia, co", "Palermo, CABA, ar", "Envigado, Envigado, co", "CO-Colombia-Remote", "San Jose, Costa Rica", "San Jose, CR"]) {
    assert.equal(classifyMarket(location), "latam", location);
  }
});

test("a bare co/pa/ar with no place or country is ambiguous: counts for neither side (other)", () => {
  for (const location of ["Erie, PA", "Boulder, CO", "Bentonville, AR", "Capital Department, AR", "Antioquia, CO"]) {
    assert.equal(classifyMarket(location), "other", location);
  }
});

test("a trailing foreign country code decides: the state-like token before it is a region", () => {
  for (const location of ["Cork, CO, ie", "Cadorago, CO, it", "Madrid, MD, es", "Barcelona, CT, es", "Almere, FL, nl", "Angers, Pays de la Loire, fr", "Ikorodu, LA, ng", "Al Sheikh Zayed, Giza Governorate, eg", "IL-Israel-Remote"]) {
    assert.equal(classifyMarket(location), "other", location);
  }
});

test("CA by position: a trailing country after a province is Canada, directly after a city is California", () => {
  for (const location of ["Toronto, ON, ca", "Montreal, QC, ca", "Vancouver, BC, ca", "CA-Ontario-Toronto", "CA-British Columbia-Remote"]) {
    assert.equal(classifyMarket(location), "other", location);
  }
  for (const location of ["San Francisco, CA", "San Jose, CA", "San Francisco, CA - Hybrid", "Irvine, CA, us", "Los Angeles, CA, United States", "US-CA-Menlo Park", "US-CA-Remote", "USA - San Francisco, CA"]) {
    assert.equal(classifyMarket(location), "us", location);
  }
});

test("CA that is not directly after a city is ambiguous and counts for neither side", () => {
  assert.equal(classifyMarket("CA Remote (BC & ON only)"), "other");
  assert.equal(classifyMarket("Remote CA"), "other");
});

test("TN by position: the trailing country wins (Chennai), directly after a city it is Tennessee", () => {
  for (const location of ["Chennai, TN, in", "Navi Mumbai, TN, in", "Oragadam, TN, in"]) {
    assert.equal(classifyMarket(location), "other", location);
  }
  for (const location of ["Nashville, TN", "Nashville, TN, USA", "Mt. Juliet, TN, us", "Chattanooga, TN"]) {
    assert.equal(classifyMarket(location), "us", location);
  }
});

test("New Mexico is a US state, not Mexico; Mexico itself is still latam", () => {
  assert.equal(classifyMarket("Albuquerque, New Mexico"), "us");
  assert.equal(classifyMarket("Santa Fe, New Mexico "), "us");
  assert.equal(classifyMarket("Mexico City"), "latam");
  assert.equal(classifyMarket("MX-Mexico-Remote"), "latam");
  assert.equal(classifyMarket("Remote, Mexico"), "latam");
});

test("a list of places is classified part by part and the best part wins, LATAM first", () => {
  assert.equal(classifyMarket("Denver, CO - Hybrid; New York, NY - Hybrid; San Francisco, CA - Hybrid"), "us");
  assert.equal(classifyMarket("Atlanta, GA - Hybrid; Denver, CO - Hybrid; New York, NY - Hybrid; Toronto, Ontario - Remote"), "us");
  assert.equal(classifyMarket("Denver, CO; Bogotá, CO"), "latam");
  assert.equal(classifyMarket("Toronto, ON, ca; Cork, CO, ie"), "other");
});

test("a list of places inside one part ends in a state, not a country", () => {
  for (const location of ["Arlington, VA or Clearwater, FL", "Washington, DC & Bethesda, MD", "Corpus Christi, TX and St. Francisville, LA", "Dallas, TX, Austin, TX", "Miami, FL / Corpus Christi, TX"]) {
    assert.equal(classifyMarket(location), "us", location);
  }
});

test("U.S. written with dots is the United States (16 rows were other)", () => {
  assert.equal(classifyMarket("U.S. Remote"), "us");
  assert.equal(classifyMarket("U.S. Anywhere"), "us");
  assert.equal(classifyMarket("Chicago, U.S. (Hybrid)"), "us");
  assert.equal(classifyMarket("CA Remote (BC & ON only); U.S. Remote"), "us");
});

test("genuinely mixed explicit countries keep the old order: LATAM wins", () => {
  assert.equal(classifyMarket("Remote (US, AR, BR, CA)"), "latam");
  assert.equal(classifyMarket("Argentina & US "), "latam");
});

// Left alone on purpose (documented in markets.ts): Perugia matches the "peru" country-name phrase, which also feeds
// the contact form's country list, and "Lima, OH" has the Lima token. "Toronto, CA" has nothing but the code after
// a city, which is California by the owner's position rule.
test("left alone: Perugia, Lima OH and Toronto, CA keep their old values", () => {
  assert.equal(classifyMarket("Perugia, IT"), "latam");
  assert.equal(classifyMarket("Lima, OH"), "latam");
  assert.equal(classifyMarket("Toronto, CA"), "us");
});

test("the market of a location never depends on how many times it is asked (no shared state)", () => {
  const locations = ["Denver, CO - Hybrid; Toronto, ON, ca", "Chennai, TN, in", "U.S. Remote", "Albuquerque, New Mexico"];
  const first = locations.map(classifyMarket);
  const second = locations.map(classifyMarket);
  assert.deepEqual(second, first);
});

test("isMiamiArea is untouched by the country-signal rewrite", () => {
  assert.equal(isMiamiArea("Tampa, FL, United States"), true);
  assert.equal(isMiamiArea("Denver, CO, USA"), false);
});

test("blank and null locations classify as other", () => {
  assert.equal(classifyMarket(null), "other");
  assert.equal(classifyMarket(""), "other");
});
