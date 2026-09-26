/**
 * Pure CSV builder for the `/contacts` list's bulk "Exportar" action (task
 * 13.2; PR 13b2). No I/O, no DB — the route handler
 * (src/app/(app)/contacts/export/route.ts) fetches rows and calls this.
 *
 * RFC4180 escaping: a cell containing a comma, double quote, or newline is
 * wrapped in double quotes, with internal double quotes doubled.
 *
 * Formula-injection guard (OWASP CSV Injection): a cell whose value starts
 * with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with a
 * leading apostrophe BEFORE quoting, so Excel/Sheets/LibreOffice open it as
 * literal text instead of evaluating it as a formula. Applied even to a
 * benign leading `-` (e.g. a negative-looking name) — the guard can't tell
 * intent apart from an actual formula prefix, so it always wins over the
 * (rare) false positive.
 */
import type { ContactColumnKey } from "@/lib/contacts/columns";

/** Prepended to the CSV text by the route handler so Excel opens UTF-8
 * (accented Spanish headers) correctly instead of guessing Latin-1. */
export const CSV_BOM = "﻿";

const INJECTION_PREFIX_CHARS = ["=", "+", "-", "@", "\t", "\r"];

function sanitizeFormulaInjection(value: string): string {
  return INJECTION_PREFIX_CHARS.some((c) => value.startsWith(c)) ? `'${value}` : value;
}

function escapeCsvCell(raw: string): string {
  const value = sanitizeFormulaInjection(raw);
  return /["\n\r,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface ContactExportRow {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  ownerName: string | null;
  // Pre-resolved via the same leadStatuses dictionary the list page uses
  // (statusLabel, not the raw status key) — the CSV builder stays pure and
  // dictionary-agnostic beyond the header labels passed in.
  statusLabel: string;
  email: string | null;
  roleGroup: string | null;
  industry: string | null;
  country: string | null;
  sourceKey: string | null;
  createdAt: Date;
  seniority: string | null;
}

export type ContactCsvHeaders = Record<"name" | ContactColumnKey, string>;

function cellValue(key: ContactColumnKey, row: ContactExportRow): string {
  switch (key) {
    case "company":
      return row.company ?? "";
    case "owner":
      return row.ownerName ?? "";
    case "status":
      return row.statusLabel;
    case "email":
      return row.email ?? "";
    case "roleGroup":
      return row.roleGroup ?? "";
    case "industry":
      return row.industry ?? "";
    case "country":
      return row.country ?? "";
    case "source":
      return row.sourceKey ?? "";
    case "created":
      return row.createdAt.toISOString().slice(0, 10);
    case "seniority":
      return row.seniority ?? "";
  }
}

function nameValue(row: ContactExportRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ");
}

/** Builds the full CSV text (no BOM — the caller prepends CSV_BOM), "Nombre"
 * always first, then the requested columns in ALL_CONTACT_COLUMNS order
 * (same order sanitizeColumnKeys already normalizes to). */
export function buildContactsCsv(
  rows: ContactExportRow[],
  columns: ContactColumnKey[],
  headers: ContactCsvHeaders,
): string {
  const headerRow = [headers.name, ...columns.map((key) => headers[key])].map(escapeCsvCell).join(",");
  const dataRows = rows.map((row) =>
    [nameValue(row), ...columns.map((key) => cellValue(key, row))].map(escapeCsvCell).join(","),
  );
  return [headerRow, ...dataRows].join("\r\n");
}
