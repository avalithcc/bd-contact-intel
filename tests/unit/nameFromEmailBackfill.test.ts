/**
 * Unit tests for src/lib/identity/nameFromEmailBackfill.ts. Pure, no DB —
 * run with: npx tsx --test tests/unit/nameFromEmailBackfill.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNameFromEmailPlan,
  deriveNameFromEmail,
  findNameCompanyCollisions,
  GENERIC_LOCAL_PARTS,
  type NameFromEmailCandidate,
} from "@/lib/identity/nameFromEmailBackfill";

// --- deriveNameFromEmail: fills ---------------------------------------------

test("two letter tokens split on a dot fill first/last in title case", () => {
  const result = deriveNameFromEmail("efrain.romero@storicard.com");
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Efrain", lastName: "Romero" },
  });
});

test("accents already present in the email are preserved, never added", () => {
  const result = deriveNameFromEmail("martín.medina@example.com");
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Martín", lastName: "Medina" },
  });
});

test("underscore and hyphen separators are both accepted", () => {
  assert.equal(deriveNameFromEmail("ana_gomez@example.com").kind, "fill");
  assert.equal(deriveNameFromEmail("ana-gomez@example.com").kind, "fill");
});

test("a +tag after the local part is stripped before splitting", () => {
  const result = deriveNameFromEmail("efrain.romero+newsletter@storicard.com");
  assert.deepEqual(result, {
    kind: "fill",
    fill: { firstName: "Efrain", lastName: "Romero" },
  });
});

// --- deriveNameFromEmail: skips ---------------------------------------------

test("a single token with no separator is skipped as single_token", () => {
  const result = deriveNameFromEmail("gusoliva@example.com");
  assert.deepEqual(result, { kind: "skip", reason: "single_token" });
});

test("three or more tokens are skipped as too_many_tokens", () => {
  const result = deriveNameFromEmail("maria.laura.fantoni@example.com");
  assert.deepEqual(result, { kind: "skip", reason: "too_many_tokens" });
});

test("an initial (single-letter token) is skipped as short_token", () => {
  const result = deriveNameFromEmail("josh.o@example.com");
  assert.deepEqual(result, { kind: "skip", reason: "short_token" });
});

test("a digit anywhere in a token is skipped as non_letter_token", () => {
  const result = deriveNameFromEmail("efrain2.romero@example.com");
  assert.deepEqual(result, { kind: "skip", reason: "non_letter_token" });
});

test("a generic/role local part is skipped as generic_word", () => {
  for (const word of ["info.contacto", "no.reply", "sales.team"]) {
    const result = deriveNameFromEmail(`${word}@example.com`);
    assert.equal(result.kind, "skip", `expected ${word} to be skipped`);
    if (result.kind === "skip") assert.equal(result.reason, "generic_word");
  }
});

test("GENERIC_LOCAL_PARTS covers the minimum required list", () => {
  for (const word of [
    "info",
    "contact",
    "contacto",
    "hello",
    "hola",
    "hi",
    "sales",
    "ventas",
    "admin",
    "office",
    "hr",
    "rrhh",
    "jobs",
    "careers",
    "talent",
    "recruiting",
    "support",
    "soporte",
    "team",
    "marketing",
    "billing",
    "finance",
    "legal",
    "press",
    "news",
    "noreply",
    "no",
    "reply",
    "comments",
    "mail",
    "notifications",
    "service",
    "help",
  ]) {
    assert.ok(GENERIC_LOCAL_PARTS.has(word), `expected "${word}" in GENERIC_LOCAL_PARTS`);
  }
});

test("malformed email (no local part) is skipped as malformed", () => {
  const result = deriveNameFromEmail("@example.com");
  assert.deepEqual(result, { kind: "skip", reason: "malformed" });
});

// --- buildNameFromEmailPlan --------------------------------------------------

function candidate(overrides: Partial<NameFromEmailCandidate> = {}): NameFromEmailCandidate {
  return { personId: "p1", email: "efrain.romero@storicard.com", companyKey: "storicard", ...overrides };
}

test("buildNameFromEmailPlan splits candidates into fills and skips", () => {
  const plan = buildNameFromEmailPlan([
    candidate({ personId: "p1", email: "efrain.romero@storicard.com" }),
    candidate({ personId: "p2", email: "gusoliva@example.com" }),
  ]);
  assert.equal(plan.fills.length, 1);
  assert.equal(plan.skips.length, 1);
  assert.deepEqual(plan.fills[0], {
    personId: "p1",
    email: "efrain.romero@storicard.com",
    firstName: "Efrain",
    lastName: "Romero",
    companyKey: "storicard",
  });
  assert.deepEqual(plan.skips[0], { personId: "p2", email: "gusoliva@example.com", reason: "single_token" });
});

test("buildNameFromEmailPlan never mutates its input (pure planner rule)", () => {
  const input = [candidate({ personId: "p1" }), candidate({ personId: "p2", email: "gusoliva@example.com" })];
  const before = JSON.parse(JSON.stringify(input));
  buildNameFromEmailPlan(input);
  assert.deepEqual(input, before);
});

test("buildNameFromEmailPlan called twice with the same input returns the same result", () => {
  const input = [candidate({ personId: "p1" }), candidate({ personId: "p2", email: "gusoliva@example.com" })];
  const first = buildNameFromEmailPlan(input);
  const second = buildNameFromEmailPlan(input);
  assert.deepEqual(first, second);
});

// --- findNameCompanyCollisions -----------------------------------------------

test("findNameCompanyCollisions flags a fill that would now share name+company with an existing person", () => {
  const fills = [
    { personId: "p1", email: "efrain.romero@storicard.com", firstName: "Efrain", lastName: "Romero", companyKey: "storicard" },
  ];
  const existing = [
    { id: "other-1", firstName: "Efrain", lastName: "Romero", companyKey: "storicard" },
    { id: "unrelated", firstName: "Jane", lastName: "Doe", companyKey: "storicard" },
  ];
  const collisions = findNameCompanyCollisions(fills, existing);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]!.personId, "p1");
  assert.deepEqual(collisions[0]!.collidesWithPersonIds, ["other-1"]);
});

test("findNameCompanyCollisions reports nothing when no existing person shares the key", () => {
  const fills = [
    { personId: "p1", email: "efrain.romero@storicard.com", firstName: "Efrain", lastName: "Romero", companyKey: "storicard" },
  ];
  const existing = [{ id: "unrelated", firstName: "Jane", lastName: "Doe", companyKey: "storicard" }];
  assert.deepEqual(findNameCompanyCollisions(fills, existing), []);
});

test("findNameCompanyCollisions skips fills with no companyKey (no key to collide on)", () => {
  const fills = [
    { personId: "p1", email: "efrain.romero@nowhere.com", firstName: "Efrain", lastName: "Romero", companyKey: null },
  ];
  const existing = [{ id: "other-1", firstName: "Efrain", lastName: "Romero", companyKey: null }];
  assert.deepEqual(findNameCompanyCollisions(fills, existing), []);
});
