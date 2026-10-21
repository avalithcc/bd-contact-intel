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

// Known and DEFERRED, asserted at their CURRENT (wrong) values. These are
// the precedence problem: LATAM_RULES is evaluated before US_RULES and
// returns early, so plainly-US text carrying a state code that is also a
// LATAM code (co 118, pa 47, ar 11 rows = 182; 40 open IT, 29 fresh IT) is
// filed latam. Fixing it needs the precedence change in classifyMarket, not
// a constants edit. When that lands, flip these expectations.
test("deferred: US text carrying co/pa is still filed latam (precedence change needed)", () => {
  assert.equal(classifyMarket("Denver, CO - Hybrid"), "latam");
  assert.equal(classifyMarket("Colorado Springs, CO, United States"), "latam");
  assert.equal(classifyMarket("Philadelphia, PA"), "latam");
});

// Also deferred: "mexico" matches as a substring inside "New Mexico" (2
// rows), bare 'ca' is both Canada and California (67 rows: 30 Canada, 37
// California), and 'peru' matches as a substring inside "Perugia" (1 row, not
// live; tokenizing it would also require tokenizing 'brasil', which would
// lose "Brasilia", and both live in LATAM_COUNTRY_NAMES).
test("deferred: other known misclassifications remain at their current values", () => {
  assert.equal(classifyMarket("Albuquerque, New Mexico"), "latam");
  assert.equal(classifyMarket("CA-Ontario-Toronto"), "us");
  assert.equal(classifyMarket("Perugia, IT"), "latam");
});

test("blank and null locations classify as other", () => {
  assert.equal(classifyMarket(null), "other");
  assert.equal(classifyMarket(""), "other");
});
