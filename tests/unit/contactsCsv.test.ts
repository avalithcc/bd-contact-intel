/**
 * Unit tests for src/lib/contacts/csvExport.ts (task 13.2, bulk "Exportar").
 * Pure CSV builder — no DB, no I/O. Covers RFC4180 escaping (commas, quotes,
 * newlines), formula-injection prefixing (cells starting with `=`, `+`,
 * `-`, `@`, tab, or CR — see OWASP CSV injection guidance), header order,
 * and the UTF-8 BOM constant the route handler prepends.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContactsCsv, CSV_BOM, type ContactExportRow } from "@/lib/contacts/csvExport";

const HEADERS = {
  name: "Nombre",
  company: "Empresa",
  owner: "Responsable",
  status: "Estado",
  email: "Correo",
  roleGroup: "Grupo de rol",
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
    roleGroup: null,
    industry: null,
    country: null,
    sourceKey: null,
    createdAt: new Date("2026-01-15T00:00:00Z"),
    seniority: null,
    ...overrides,
  };
}

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
