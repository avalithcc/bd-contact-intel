/**
 * Unit tests for src/lib/hubspot/owners.ts (task 1.6).
 * Owner mapping per hubspot-import spec "Owner mapping": accent/case
 * -insensitive name match, blank/deactivated owner -> unassigned, unknown
 * name -> unassigned + counted. BD names are not contact PII.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeactivatedOwner, matchHubSpotOwner } from "@/lib/hubspot/owners";

const BDS = [
  { id: "bd-1", name: "Macarena Dávila" },
  { id: "bd-2", name: "Beto Prueba" },
];

test("matches an owner name that differs only by accents (accent-insensitive)", () => {
  const result = matchHubSpotOwner("Macarena Davila", BDS);
  assert.equal(result.bdId, "bd-1");
  assert.equal(result.unknownOwnerName, null);
});

test("matches an owner name that differs only by case", () => {
  const result = matchHubSpotOwner("beto prueba", BDS);
  assert.equal(result.bdId, "bd-2");
});

test("a blank owner is unassigned", () => {
  const result = matchHubSpotOwner("", BDS);
  assert.equal(result.bdId, null);
  assert.equal(result.unknownOwnerName, null);
});

test("a deactivated owner is unassigned, distinct from an unknown name", () => {
  const result = matchHubSpotOwner("Ana Prueba (Deactivated User)", BDS);
  assert.equal(result.bdId, null);
  assert.equal(result.unknownOwnerName, null);
});

test("an unknown owner name is unassigned and counted as unknown", () => {
  const result = matchHubSpotOwner("Alguien Desconocido", BDS);
  assert.equal(result.bdId, null);
  assert.equal(result.unknownOwnerName, "Alguien Desconocido");
});

test("isDeactivatedOwner detects the '(Deactivated ...)' suffix", () => {
  assert.equal(isDeactivatedOwner("Ana Prueba (Deactivated User)"), true);
  assert.equal(isDeactivatedOwner("Ana Prueba"), false);
});
