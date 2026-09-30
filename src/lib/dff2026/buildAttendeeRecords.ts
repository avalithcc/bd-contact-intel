/**
 * Pure CSV parsing for the Digital Finance Forum 2026 attendee list
 * (scripts/import-dff-2026.ts; source file "Inscriptos presenciales",
 * gitignored under backups/). No DB access — planImport.ts consumes the
 * output.
 *
 * Column layout (measured, includes a leading and trailing EMPTY header
 * cell): `"", ASISTIÓ, APELLIDO, NOMBRE, EMPRESA, CARGO, OTRO CARGO,
 * CELULAR, EMAIL, ""`. Parsed with `columns: false` (positional arrays)
 * rather than csv-parse's `columns: true` object mode: the header has TWO
 * columns literally named `""`, which would collide as object keys and
 * silently drop one of them. Column indices below are fixed by this exact,
 * measured header order.
 */
import { parse } from "csv-parse/sync";
import { normalizeNameKey } from "@/lib/leads/csv";
import { cleanField, stripControlChars } from "./textClean";

export interface AttendeeRecord {
  firstName: string | null;
  lastName: string | null;
  /** CARGO, except when CARGO reads "Otro" (case/accent-insensitive) — then
   * OTRO CARGO, when present. See resolveJobTitle. */
  jobTitle: string | null;
  /** Raw, trimmed/control-stripped CELULAR — never reformatted (owner
   * decision 2026-09-30: "no solo tienen email sino teléfonos y ese valor
   * es el más importante acá" — rewriting on an assumption is not
   * acceptable). Validated later by planImport.ts via src/lib/phone.ts. */
  mobilePhoneRaw: string | null;
  companyRaw: string | null;
  email: string;
  emailNormalized: string;
  /** ASISTIÓ === "1". The remaining rows registered but did not attend. */
  attended: boolean;
}

export interface DuplicateEmailCollision {
  email: string;
  occurrences: number;
}

export interface BuildAttendeeRecordsResult {
  /** One row per unique, valid email — in-file duplicates already merged
   * (most-complete-row wins; attended is OR'd across duplicates). */
  records: AttendeeRecord[];
  rowsParsed: number;
  skippedNoEmail: number;
  duplicateEmailCollisions: DuplicateEmailCollision[];
}

const OTRO_KEY = normalizeNameKey("Otro");

/**
 * Job title rule (task brief): CARGO, except when CARGO reads "Otro"
 * (case/accent-insensitive) — then OTRO CARGO. When CARGO is "Otro" and
 * OTRO CARGO is blank, the job title is left null rather than falling back
 * to the literal word "Otro". CARGO is used verbatim in every other case,
 * even when OTRO CARGO also happens to carry a (presumably stale) value.
 *
 * No title-casing is applied anywhere in this module — a value like
 * "Gerente De Área" (capitalized "De") ships EXACTLY as it reads in the
 * source file; this import only fixes the 4 verified mojibake characters
 * (cleanField -> repairMojibake) and never reshapes casing. Confirmed by
 * inspection (owner report, 2026-09-30 dry run): the "De" capitalization
 * is a pre-existing characteristic of the CARGO column itself, not
 * something this parser introduces.
 */
export function resolveJobTitle(cargo: string | null, otroCargo: string | null): string | null {
  if (cargo && normalizeNameKey(cargo) === OTRO_KEY) return otroCargo;
  return cargo;
}

function completenessScore(r: Pick<AttendeeRecord, "firstName" | "lastName" | "jobTitle" | "mobilePhoneRaw" | "companyRaw">): number {
  return [r.firstName, r.lastName, r.jobTitle, r.mobilePhoneRaw, r.companyRaw].filter(Boolean).length;
}

export function buildAttendeeRecords(rawCsvText: string): BuildAttendeeRecordsResult {
  const sanitized = stripControlChars(rawCsvText.replace(/^﻿/, ""));
  const rows = parse(sanitized, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as string[][];
  const dataRows = rows.slice(1); // drop the header row

  let skippedNoEmail = 0;
  const byEmail = new Map<string, AttendeeRecord[]>();

  for (const row of dataRows) {
    const asistio = cleanField(row[1]);
    const lastName = cleanField(row[2]);
    const firstName = cleanField(row[3]);
    const companyRaw = cleanField(row[4]);
    const cargo = cleanField(row[5]);
    const otroCargo = cleanField(row[6]);
    const mobilePhoneRaw = cleanField(row[7]);
    const emailRaw = cleanField(row[8]);

    if (!emailRaw || !emailRaw.includes("@")) {
      skippedNoEmail++;
      continue;
    }
    const emailNormalized = emailRaw.toLowerCase();
    const record: AttendeeRecord = {
      firstName,
      lastName,
      jobTitle: resolveJobTitle(cargo, otroCargo),
      mobilePhoneRaw,
      companyRaw,
      email: emailRaw,
      emailNormalized,
      attended: asistio === "1",
    };
    const list = byEmail.get(emailNormalized) ?? [];
    list.push(record);
    byEmail.set(emailNormalized, list);
  }

  const records: AttendeeRecord[] = [];
  const duplicateEmailCollisions: DuplicateEmailCollision[] = [];
  for (const [email, list] of byEmail) {
    if (list.length > 1) duplicateEmailCollisions.push({ email, occurrences: list.length });
    // Array.prototype.sort is stable (ES2019+): a tie keeps the
    // first-encountered row, so this is deterministic across runs.
    const best = [...list].sort((a, b) => completenessScore(b) - completenessScore(a))[0]!;
    records.push({ ...best, attended: list.some((r) => r.attended) });
  }

  return { records, rowsParsed: dataRows.length, skippedNoEmail, duplicateEmailCollisions };
}
