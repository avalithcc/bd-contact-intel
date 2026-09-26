/**
 * Unit tests for src/lib/hubspot/uuidv5.ts (task 1.1/1.2).
 * `person_id_map.legacy_id` is a `uuid` column; HubSpot record IDs are
 * numeric strings, so they are mapped deterministically via UUID v5 over a
 * pinned namespace (design D1 — "External non-uuid legacy id mapping").
 * The test vector below pins HUBSPOT_NAMESPACE: if it ever changes, every
 * previously imported row would silently get a new id and re-import would
 * stop being idempotent — this test is the guard against that regression.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hubspotLegacyId, HUBSPOT_NAMESPACE } from "@/lib/hubspot/uuidv5";
import { isUuid } from "@/lib/uuid";

test("HUBSPOT_NAMESPACE is pinned to a fixed UUID", () => {
  assert.equal(HUBSPOT_NAMESPACE, "db3997e9-495c-4cb4-aa7c-02c858215bac");
});

test("hubspotLegacyId derives a well-formed uuid from a HubSpot record id", () => {
  const id = hubspotLegacyId("123456789");
  assert.equal(isUuid(id), true);
});

test("hubspotLegacyId is deterministic — same input always produces the same id", () => {
  const first = hubspotLegacyId("123456789");
  const second = hubspotLegacyId("123456789");
  assert.equal(first, second);
});

test("hubspotLegacyId produces different ids for different HubSpot record ids", () => {
  const a = hubspotLegacyId("123456789");
  const b = hubspotLegacyId("987654321");
  assert.notEqual(a, b);
});

test("hubspotLegacyId matches a pinned test vector", () => {
  // Pinned vector for HUBSPOT_NAMESPACE + record id "1" — guards against an
  // accidental change to the derivation algorithm (e.g. swapping SHA-1 for
  // SHA-256, or changing byte layout) that would silently break idempotent
  // re-import for every already-imported contact.
  assert.equal(hubspotLegacyId("1"), "3aaee4df-7d53-527d-806a-10655d9d36eb");
});
