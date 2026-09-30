/**
 * Unit tests for src/lib/identity/commonGivenNames.ts. Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMON_GIVEN_NAMES, isCommonGivenName } from "@/lib/identity/commonGivenNames";

test("recognizes every name in the owner-required minimum list (task ask, 2026-09-30)", () => {
  const required = [
    "sol", "florencia", "andres", "fernando", "alexis", "nicolas", "guillermo", "omar",
    "manuel", "pablo", "paulo", "andre", "jose", "maria", "juan", "luis", "carlos", "ana",
    "laura", "lucia", "belen", "jesus", "antonio", "alejandro", "martin", "ignacio",
    "agustin", "sebastian", "gabriel", "daniel", "david", "eduardo", "emilio", "esteban",
    "federico", "francisco", "gonzalo", "javier", "jorge", "julian", "leandro", "lorena",
    "marcela", "matias", "miguel", "pedro", "rafael", "ramon", "ricardo", "roberto",
    "rodrigo", "santiago", "sergio", "tomas", "valentina", "victoria",
  ];
  for (const name of required) {
    assert.ok(COMMON_GIVEN_NAMES.has(name), `expected COMMON_GIVEN_NAMES to include "${name}"`);
  }
});

test("isCommonGivenName is accent-insensitive and case-insensitive", () => {
  assert.equal(isCommonGivenName("Andrés"), true);
  assert.equal(isCommonGivenName("ANDRES"), true);
  assert.equal(isCommonGivenName("andrés"), true);
  assert.equal(isCommonGivenName("Nicolás"), true);
  assert.equal(isCommonGivenName("nicolas"), true);
});

test("isCommonGivenName is false for a name NOT on the list", () => {
  assert.equal(isCommonGivenName("Zzyzx"), false);
});

test("deliberately excludes 'vicente' — it is a SURNAME in the production sample 'Alicia Vicente Andrés' (task ask)", () => {
  assert.equal(COMMON_GIVEN_NAMES.has("vicente"), false);
  assert.equal(isCommonGivenName("Vicente"), false);
});

test("includes 'damian' — required by the task's own worked LinkedIn-cleanup example ('Hector Damian Lema' -> 'Hector Damian' / 'Lema' via the given-name rule)", () => {
  assert.equal(isCommonGivenName("Damian"), true);
});
