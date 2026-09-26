/**
 * Unit tests for src/lib/hubspot/contacts.ts (task 1.5).
 * Pure row -> typed HubSpotContactRow mapper: trim, blank->null, integers,
 * dates, URL normalization. Fixtures use synthetic data only (fake names,
 * example.com), never the real export.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapHubSpotContactRow } from "@/lib/hubspot/contacts";

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "ID de registro": "123",
    Nombre: "  Ana  ",
    Apellidos: "Prueba",
    Correo: " ana.prueba@example.com ",
    Cargo: "",
    Ciudad: "Buenos Aires",
    "País/región": "Argentina",
    "Número de teléfono": "",
    "URL de LinkedIn": "linkedin.com/in/ana-prueba",
    "Propietario del contacto": "Beto Prueba",
    "Número de veces contactado": "3",
    "Último contacto": "2026-01-15",
    "Última actividad": "",
    "Fecha de creación": "2025-12-01",
    "Estado del lead": "En curso",
    "Associated Company IDs (Primary)": "555",
    ...overrides,
  };
}

test("maps a well-formed row: trims strings, keeps present values", () => {
  const mapped = mapHubSpotContactRow(row());
  assert.equal(mapped.hubspotContactId, "123");
  assert.equal(mapped.firstName, "Ana");
  assert.equal(mapped.lastName, "Prueba");
  assert.equal(mapped.email, "ana.prueba@example.com");
  assert.equal(mapped.ownerRaw, "Beto Prueba");
  assert.equal(mapped.associatedCompanyIdPrimary, "555");
});

test("blank string fields become null", () => {
  const mapped = mapHubSpotContactRow(row({ Cargo: "", "Número de teléfono": "  ", "Última actividad": "" }));
  assert.equal(mapped.jobTitle, null);
  assert.equal(mapped.phone, null);
  assert.equal(mapped.lastActivityAt, null);
});

test("parses an integer field, defaulting to 0 when blank", () => {
  assert.equal(mapHubSpotContactRow(row({ "Número de veces contactado": "7" })).timesContacted, 7);
  assert.equal(mapHubSpotContactRow(row({ "Número de veces contactado": "" })).timesContacted, 0);
});

test("parses date fields into Date objects, null when unparseable", () => {
  const mapped = mapHubSpotContactRow(row({ "Último contacto": "2026-01-15" }));
  assert.ok(mapped.lastContactAt instanceof Date);
  assert.equal(mapped.lastContactAt!.getUTCFullYear(), 2026);

  const invalid = mapHubSpotContactRow(row({ "Último contacto": "not-a-date" }));
  assert.equal(invalid.lastContactAt, null);
});

test("normalizes a bare-domain LinkedIn URL to an https URL", () => {
  const mapped = mapHubSpotContactRow(row({ "URL de LinkedIn": "linkedin.com/in/ana-prueba" }));
  assert.equal(mapped.linkedinUrl, "https://linkedin.com/in/ana-prueba");
});

test("leaves an already-https LinkedIn URL untouched, and null when blank", () => {
  const mapped = mapHubSpotContactRow(row({ "URL de LinkedIn": "https://www.linkedin.com/in/beto" }));
  assert.equal(mapped.linkedinUrl, "https://www.linkedin.com/in/beto");
  assert.equal(mapHubSpotContactRow(row({ "URL de LinkedIn": "" })).linkedinUrl, null);
});

test("prefers the 'LinkedIn' column over 'URL de LinkedIn' when both are filled", () => {
  const mapped = mapHubSpotContactRow(
    row({ LinkedIn: "linkedin.com/in/from-linkedin-column", "URL de LinkedIn": "linkedin.com/in/from-url-column" }),
  );
  assert.equal(mapped.linkedinUrl, "https://linkedin.com/in/from-linkedin-column");
});

test("falls back to 'URL de LinkedIn' when 'LinkedIn' is blank", () => {
  const mapped = mapHubSpotContactRow(row({ LinkedIn: "", "URL de LinkedIn": "linkedin.com/in/from-url-column" }));
  assert.equal(mapped.linkedinUrl, "https://linkedin.com/in/from-url-column");
});

test("linkedinUrl is null when both LinkedIn columns are blank or absent", () => {
  assert.equal(mapHubSpotContactRow(row({ LinkedIn: "", "URL de LinkedIn": "" })).linkedinUrl, null);
});

test("parses 'YYYY-MM-DD HH:mm' portal-local timestamps as Argentina time (UTC-3), independent of process TZ", () => {
  // 2026-09-21 16:34 in America/Argentina/Buenos_Aires (UTC-3, no DST) is
  // 2026-09-21T19:34:00Z.
  const mapped = mapHubSpotContactRow(row({ "Último contacto": "2026-09-21 16:34" }));
  assert.ok(mapped.lastContactAt instanceof Date);
  assert.equal(mapped.lastContactAt!.toISOString(), "2026-09-21T19:34:00.000Z");
});

test("parses a date-only value as portal-local midnight (Argentina, UTC-3)", () => {
  const mapped = mapHubSpotContactRow(row({ "Fecha de creación": "2026-01-15" }));
  assert.equal(mapped.createdAt!.toISOString(), "2026-01-15T03:00:00.000Z");
});

test("takes the first company id and flags it when Associated Company IDs (Primary) has multiple semicolon-separated ids", () => {
  const mapped = mapHubSpotContactRow(row({ "Associated Company IDs (Primary)": "555;777;888" }));
  assert.equal(mapped.associatedCompanyIdPrimary, "555");
  assert.equal(mapped.associatedCompanyIdPrimaryMultiple, true);
});

test("does not flag a single Associated Company IDs (Primary) value", () => {
  const mapped = mapHubSpotContactRow(row({ "Associated Company IDs (Primary)": "555" }));
  assert.equal(mapped.associatedCompanyIdPrimary, "555");
  assert.equal(mapped.associatedCompanyIdPrimaryMultiple, false);
});
