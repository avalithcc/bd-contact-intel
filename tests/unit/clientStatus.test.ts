/**
 * Unit tests for src/lib/companies/clientStatus.ts — the vocabulary of the
 * hand-set `company.client_status` field ('active' | 'inactive'; null means
 * "not stated"). Pure: vocabulary guard and label mapping only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { company } from "@/db/schema";
import { CLIENT_STATUSES, clientStatusLabel, isClientStatus } from "@/lib/companies/clientStatus";

const LABELS = { clientStatusActive: "Activo", clientStatusInactive: "Inactivo" };

test("the vocabulary is exactly active | inactive", () => {
  assert.deepEqual([...CLIENT_STATUSES], ["active", "inactive"]);
});

test("isClientStatus accepts each known value", () => {
  assert.equal(isClientStatus("active"), true);
  assert.equal(isClientStatus("inactive"), true);
});

test("isClientStatus rejects unknown values, case variants, empty and undefined", () => {
  assert.equal(isClientStatus("Active"), false);
  assert.equal(isClientStatus("dormant"), false);
  assert.equal(isClientStatus(""), false);
  assert.equal(isClientStatus(undefined), false);
});

test("clientStatusLabel maps each value to its label", () => {
  assert.equal(clientStatusLabel("active", LABELS), "Activo");
  assert.equal(clientStatusLabel("inactive", LABELS), "Inactivo");
});

test("clientStatusLabel renders null as the em dash and passes unknown values through", () => {
  assert.equal(clientStatusLabel(null, LABELS), "—");
  assert.equal(clientStatusLabel("paused", LABELS), "paused");
});

test("company exposes a nullable client_status column", () => {
  assert.equal(company.clientStatus.name, "client_status");
  assert.equal(company.clientStatus.notNull, false);
  assert.equal(company.clientStatus.hasDefault, false);
});
