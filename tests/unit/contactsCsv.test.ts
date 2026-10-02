/**
 * Unit tests for src/lib/contacts/csvExport.ts (task 13.2, bulk "Exportar").
 * Pure CSV builder — no DB, no I/O. Covers RFC4180 escaping (commas, quotes,
 * newlines), formula-injection prefixing (cells starting with `=`, `+`,
 * `-`, `@`, tab, or CR — see OWASP CSV injection guidance), header order,
 * and the UTF-8 BOM constant the route handler prepends.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContactsCsv, CSV_BOM, mapContactRowToExportRow, type ContactExportRow } from "@/lib/contacts/csvExport";
import type { ContactListRow } from "@/lib/contacts/listQueries";

const HEADERS = {
  name: "Nombre",
  company: "Empresa",
  owner: "Responsable",
  status: "Estado",
  email: "Correo",
  phone: "Teléfono",
  bdConnections: "BDs conectados",
  lastActivity: "Última actividad",
  roleGroup: "Grupo de rol",
  contactType: "Tipo de contacto",
  industry: "Industria",
  country: "País",
  source: "Origen",
  created: "Creado",
  seniority: "Seniority",
};

function row(overrides: Partial<ContactExportRow> = {}): ContactExportRow {
  return {
    firstName: "Ana",
    lastName: "Gomez",
    company: "Acme",
    ownerName: "Bruno",
    statusLabel: "Nuevo",
    email: "ana@acme.com",
    phone: null,
    roleGroup: null,
    contactType: null,
    industry: null,
    country: null,
    sourceKey: null,
    createdAt: new Date("2026-01-15T00:00:00Z"),
    seniority: null,
    bdConnectionNames: "",
    lastActivityText: "",
    ...overrides,
  };
}

test("buildContactsCsv renders the bdConnections column as the comma-joined BD names", () => {
  const csv = buildContactsCsv(
    [row({ bdConnectionNames: "Ana Pereyra, Cristian Civita" })],
    ["bdConnections"],
    HEADERS,
  );
  assert.equal(csv.split("\r\n")[1], 'Ana Gomez,"Ana Pereyra, Cristian Civita"');
});

test("buildContactsCsv renders header + row for the selected columns, in column order", () => {
  const csv = buildContactsCsv([row()], ["company", "owner"], HEADERS);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Nombre,Empresa,Responsable");
  assert.equal(lines[1], "Ana Gomez,Acme,Bruno");
});

test("buildContactsCsv formats createdAt as an ISO date", () => {
  const csv = buildContactsCsv([row()], ["created"], HEADERS);
  const lines = csv.split("\r\n");
  assert.equal(lines[1], "Ana Gomez,2026-01-15");
});

test("buildContactsCsv renders missing values as an empty cell", () => {
  const csv = buildContactsCsv([row({ company: null, ownerName: null })], ["company", "owner"], HEADERS);
  const lines = csv.split("\r\n");
  assert.equal(lines[1], "Ana Gomez,,");
});

test("buildContactsCsv quotes a cell containing a comma", () => {
  const csv = buildContactsCsv([row({ company: "Acme, Inc" })], ["company"], HEADERS);
  assert.equal(csv.split("\r\n")[1], 'Ana Gomez,"Acme, Inc"');
});

test("buildContactsCsv quotes and doubles internal quotes", () => {
  const csv = buildContactsCsv([row({ company: 'Acme "The Best"' })], ["company"], HEADERS);
  assert.equal(csv.split("\r\n")[1], 'Ana Gomez,"Acme ""The Best"""');
});

test("buildContactsCsv quotes a cell containing a newline", () => {
  const csv = buildContactsCsv([row({ company: "Acme\nSecond line" })], ["company"], HEADERS);
  assert.equal(csv.split("\r\n")[1], 'Ana Gomez,"Acme\nSecond line"');
});

test("buildContactsCsv prefixes formula-injection characters with an apostrophe", () => {
  for (const dangerous of ["=cmd()", "+1", "-1", "@SUM(A1)", "\ttab", "\rcr"]) {
    const csv = buildContactsCsv([row({ company: dangerous })], ["company"], HEADERS);
    const cell = csv.split("\r\n")[1]!.slice("Ana Gomez,".length);
    assert.ok(cell.startsWith("'") || cell.startsWith('"\''), `expected ${JSON.stringify(dangerous)} to be prefixed, got ${cell}`);
  }
});

test("buildContactsCsv does not prefix ordinary text", () => {
  const csv = buildContactsCsv([row({ company: "Acme Corp" })], ["company"], HEADERS);
  assert.equal(csv.split("\r\n")[1], "Ana Gomez,Acme Corp");
});

test("CSV_BOM is the UTF-8 byte-order-mark character", () => {
  assert.equal(CSV_BOM, "﻿");
});

function contactListRow(overrides: Partial<ContactListRow> = {}): ContactListRow {
  return {
    id: "p1",
    firstName: "Ana",
    lastName: "Gomez",
    jobTitle: null,
    company: "Acme",
    companyKey: "acme",
    ownerBdId: null,
    ownerName: "Bruno",
    status: "new",
    email: "ana@acme.com",
    emailStatus: "verified",
    phone: null,
    mobilePhone: null,
    roleGroup: null,
    contactType: null,
    industry: null,
    country: null,
    sourceKey: null,
    createdAt: new Date("2026-01-15T00:00:00Z"),
    seniority: null,
    bdConnections: { avatars: [], title: "" },
    lastActivity: null,
    ...overrides,
  };
}

test("mapContactRowToExportRow: no BDs connected / no activity renders as empty strings, not 'null'", () => {
  const row = mapContactRowToExportRow(contactListRow(), "Nuevo");
  assert.equal(row.bdConnectionNames, "");
  assert.equal(row.lastActivityText, "");
  assert.equal(row.statusLabel, "Nuevo");
});

test("mapContactRowToExportRow: bdConnections title and formatted last-activity text carry through", () => {
  const row = mapContactRowToExportRow(
    contactListRow({
      bdConnections: { avatars: [{ bdId: "bd1", name: "Ana Pereyra", initials: "AP" }], title: "Ana Pereyra" },
      lastActivity: { type: "email_sent", label: "Correo enviado", createdAt: new Date("2026-02-01T00:00:00Z") },
    }),
    "Nuevo",
  );
  assert.equal(row.bdConnectionNames, "Ana Pereyra");
  assert.equal(row.lastActivityText, "Correo enviado (2026-02-01)");
});

test("mapContactRowToExportRow: phone prefers `phone`, falls back to `mobilePhone`", () => {
  assert.equal(mapContactRowToExportRow(contactListRow({ phone: "+54 11 4000-0000" }), "Nuevo").phone, "+54 11 4000-0000");
  assert.equal(
    mapContactRowToExportRow(contactListRow({ phone: null, mobilePhone: "+54 9 11 4123-4567" }), "Nuevo").phone,
    "+54 9 11 4123-4567",
  );
  assert.equal(mapContactRowToExportRow(contactListRow(), "Nuevo").phone, null);
});

test("contact type exports as its Spanish label, empty as an empty cell", () => {
  const csv = buildContactsCsv(
    [row({ contactType: "BUYER-CHAMPION" }), row({ contactType: "INFLUENCER" }), row({ contactType: null })],
    ["contactType"],
    HEADERS,
  );
  assert.deepEqual(csv.split("\r\n"), [
    "Nombre,Tipo de contacto",
    "Ana Gomez,Comprador / promotor",
    "Ana Gomez,Influenciador",
    "Ana Gomez,",
  ]);
});

test("mapContactRowToExportRow carries the stored contact type through", () => {
  assert.equal(mapContactRowToExportRow(contactListRow({ contactType: "INFLUENCER" }), "Nuevo").contactType, "INFLUENCER");
});

test("mapContactRowToExportRow: a blank phone never shadows the mobile, and the value is trimmed", () => {
  assert.equal(
    mapContactRowToExportRow(contactListRow({ phone: "  ", mobilePhone: " +54 9 11 4123-4567 " }), "Nuevo").phone,
    "+54 9 11 4123-4567",
  );
});

test("phone cells survive a spreadsheet: separators stay, bare digits are forced to text", () => {
  const cell = (phone: string) =>
    buildContactsCsv([row({ phone })], ["phone"], HEADERS).split("\r\n")[1]!.slice("Ana Gomez,".length);
  // Display form (not digits-only) is exported: stripping separators would
  // hand Excel a number. A leading `+` keeps the formula guard apostrophe
  // because "+54-11-4123-4567" would otherwise be evaluated as arithmetic.
  assert.equal(cell("(011) 4123-4567"), "(011) 4123-4567");
  assert.equal(cell("+54 11 4123-4567"), "'+54 11 4123-4567");
  // Bare digits would lose the leading zero / go scientific as a number.
  assert.equal(cell("01141234567"), "'01141234567");
});
