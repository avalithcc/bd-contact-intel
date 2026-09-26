/**
 * Unit tests for src/lib/hubspot/columns.ts (task 1.3).
 * Pins the required Spanish header strings from the real HubSpot exports
 * (header line only — column names are not PII, see PII rules in
 * openspec/changes/hubspot-import/design.md D8) and asserts a missing
 * required header fails listing the missing NAMES, never the row data.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REQUIRED_CONTACT_HEADERS,
  REQUIRED_COMPANY_HEADERS,
  OPTIONAL_CONTACT_LINKEDIN_HEADERS,
  assertRequiredHeaders,
  assertNoDuplicateRequiredHeaders,
} from "@/lib/hubspot/columns";

test("REQUIRED_CONTACT_HEADERS pins the exact Spanish header strings from the real export", () => {
  assert.equal(REQUIRED_CONTACT_HEADERS.includes("ID de registro"), true);
  assert.equal(REQUIRED_CONTACT_HEADERS.includes("Correo"), true);
  assert.equal(REQUIRED_CONTACT_HEADERS.includes("Associated Company IDs (Primary)"), true);
});

test("REQUIRED_COMPANY_HEADERS pins the exact Spanish header strings from the real export", () => {
  assert.equal(REQUIRED_COMPANY_HEADERS.includes("Nombre de la empresa"), true);
  assert.equal(REQUIRED_COMPANY_HEADERS.includes("Nombre de dominio de la empresa"), true);
  assert.equal(REQUIRED_COMPANY_HEADERS.includes("Associated Note"), true);
});

test("assertRequiredHeaders passes when every required header is present", () => {
  assert.doesNotThrow(() =>
    assertRequiredHeaders(["ID de registro", "Correo", "Extra column"], ["ID de registro", "Correo"]),
  );
});

test("assertRequiredHeaders matches headers after NFC-normalizing and trimming whitespace", () => {
  // "é" as combining sequence (NFD) + trailing whitespace, as some exports
  // encode header cells — must still match the NFC-composed pinned name.
  const decomposedWithPadding = ` Correó `.normalize("NFD");
  assert.doesNotThrow(() => assertRequiredHeaders([decomposedWithPadding], ["Correó"]));
});

test("assertRequiredHeaders throws listing the missing header NAMES, not any row data", () => {
  assert.throws(
    () => assertRequiredHeaders(["ID de registro"], ["ID de registro", "Correo", "Nombre"]),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Correo/);
      assert.match(err.message, /Nombre/);
      return true;
    },
  );
});

test("REQUIRED_CONTACT_HEADERS does not require either LinkedIn column (neither is reliably filled)", () => {
  assert.equal(REQUIRED_CONTACT_HEADERS.includes("LinkedIn"), false);
  assert.equal(REQUIRED_CONTACT_HEADERS.includes("URL de LinkedIn"), false);
});

test("OPTIONAL_CONTACT_LINKEDIN_HEADERS pins both LinkedIn header names, 'LinkedIn' first", () => {
  assert.deepEqual(OPTIONAL_CONTACT_LINKEDIN_HEADERS, ["LinkedIn", "URL de LinkedIn"]);
});

test("assertNoDuplicateRequiredHeaders passes when no required header repeats", () => {
  assert.doesNotThrow(() =>
    assertNoDuplicateRequiredHeaders(["ID de registro", "Correo", "Función laboral"], ["ID de registro", "Correo"]),
  );
});

test("assertNoDuplicateRequiredHeaders throws listing the duplicated required header NAMES, not any row data", () => {
  assert.throws(
    () =>
      assertNoDuplicateRequiredHeaders(
        ["ID de registro", "Correo", "Correo", "Billing Contact IDs", "Billing Contact IDs"],
        ["ID de registro", "Correo", "Billing Contact IDs"],
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Correo/);
      assert.match(err.message, /Billing Contact IDs/);
      assert.doesNotMatch(err.message, /ID de registro/);
      return true;
    },
  );
});

test("assertNoDuplicateRequiredHeaders ignores duplicates of non-required headers", () => {
  assert.doesNotThrow(() =>
    assertNoDuplicateRequiredHeaders(
      ["ID de registro", "Función laboral", "Función laboral"],
      ["ID de registro"],
    ),
  );
});
