/**
 * Unit tests for src/lib/hubspot/phoneBackfill.ts — pure row-mapping and
 * fill-empty planner behind scripts/backfill-hubspot-phones.ts. Synthetic
 * fixtures only, never real hubspot/ exports (PII).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapPhoneBackfillRow,
  planPhoneBackfill,
  type ExistingPersonPhoneRow,
} from "@/lib/hubspot/phoneBackfill";
import { hubspotLegacyId } from "@/lib/hubspot/uuidv5";

test("mapPhoneBackfillRow trims the record id and blanks empty phone/mobile cells to null", () => {
  const row = mapPhoneBackfillRow({
    "ID de registro": " 12345 ",
    "Número de teléfono": " +54 11 4000-0000 ",
    "Número de móvil": "  ",
  });
  assert.deepEqual(row, {
    hubspotContactId: "12345",
    phone: "+54 11 4000-0000",
    mobilePhone: null,
  });
});

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";

function existingRow(overrides: Partial<ExistingPersonPhoneRow> & { legacyId: string }): ExistingPersonPhoneRow {
  return { personId: P1, phone: null, mobilePhone: null, ...overrides };
}

test("planPhoneBackfill fills phone/mobilePhone only for a matched person with both currently empty", () => {
  const legacyId = hubspotLegacyId("12345");
  const rows = [mapPhoneBackfillRow({ "ID de registro": "12345", "Número de teléfono": "+54 11 4000-0000", "Número de móvil": "+54 9 11 4123-4567" })];
  const existing = new Map([[legacyId, existingRow({ legacyId, personId: P1 })]]);

  const plan = planPhoneBackfill(rows, existing);
  assert.deepEqual(plan.updates, [{ personId: P1, phone: "+54 11 4000-0000", mobilePhone: "+54 9 11 4123-4567" }]);
  assert.equal(plan.matched, 1);
  assert.equal(plan.skippedNoMatch, 0);
  assert.equal(plan.skippedNoNewData, 0);
});

test("planPhoneBackfill is fill-empty only: never overwrites an existing phone/mobilePhone value", () => {
  const legacyId = hubspotLegacyId("12345");
  const rows = [mapPhoneBackfillRow({ "ID de registro": "12345", "Número de teléfono": "+54 11 9999-9999", "Número de móvil": "+54 9 11 0000-0000" })];
  const existing = new Map([
    [legacyId, existingRow({ legacyId, personId: P1, phone: "+54 11 4000-0000", mobilePhone: "+54 9 11 4123-4567" })],
  ]);

  const plan = planPhoneBackfill(rows, existing);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.matched, 1);
  assert.equal(plan.skippedNoNewData, 1);
});

test("planPhoneBackfill fills only the empty one of phone/mobilePhone, leaving the other untouched", () => {
  const legacyId = hubspotLegacyId("12345");
  const rows = [mapPhoneBackfillRow({ "ID de registro": "12345", "Número de teléfono": "+54 11 4000-0000", "Número de móvil": "+54 9 11 4123-4567" })];
  const existing = new Map([
    [legacyId, existingRow({ legacyId, personId: P1, phone: "+54 11 1111-1111", mobilePhone: null })],
  ]);

  const plan = planPhoneBackfill(rows, existing);
  assert.deepEqual(plan.updates, [{ personId: P1, mobilePhone: "+54 9 11 4123-4567" }]);
});

test("planPhoneBackfill counts a row with no matching person_id_map entry as skippedNoMatch, writes nothing", () => {
  const rows = [mapPhoneBackfillRow({ "ID de registro": "99999", "Número de teléfono": "+54 11 4000-0000", "Número de móvil": "" })];
  const plan = planPhoneBackfill(rows, new Map());
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.matched, 0);
  assert.equal(plan.skippedNoMatch, 1);
});

test("planPhoneBackfill skips a row with no phone data at all (both blank)", () => {
  const legacyId = hubspotLegacyId("12345");
  const rows = [mapPhoneBackfillRow({ "ID de registro": "12345", "Número de teléfono": "", "Número de móvil": "" })];
  const existing = new Map([[legacyId, existingRow({ legacyId, personId: P1 })]]);
  const plan = planPhoneBackfill(rows, existing);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.skippedNoNewData, 1);
});

test("planPhoneBackfill processes multiple rows independently", () => {
  const legacyId1 = hubspotLegacyId("1");
  const legacyId2 = hubspotLegacyId("2");
  const rows = [
    mapPhoneBackfillRow({ "ID de registro": "1", "Número de teléfono": "+54 11 1111-1111", "Número de móvil": "" }),
    mapPhoneBackfillRow({ "ID de registro": "2", "Número de teléfono": "", "Número de móvil": "+54 9 11 2222-2222" }),
  ];
  const existing = new Map([
    [legacyId1, existingRow({ legacyId: legacyId1, personId: P1 })],
    [legacyId2, existingRow({ legacyId: legacyId2, personId: P2 })],
  ]);
  const plan = planPhoneBackfill(rows, existing);
  assert.deepEqual(plan.updates, [
    { personId: P1, phone: "+54 11 1111-1111" },
    { personId: P2, mobilePhone: "+54 9 11 2222-2222" },
  ]);
  assert.equal(plan.matched, 2);
});
