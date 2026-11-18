import { argentinaWallClockToUtc } from "@/lib/tasks/argentinaDate";

/** The portal's column titles, verbatim. A file missing any of them is not the COMPR.AR export. */
export const PORTAL_COLUMNS = {
  processNumber: "Número de Proceso",
  fileNumber: "Expediente",
  name: "Nombre proceso",
  processType: "Tipo proceso",
  openingAt: "Fecha de apertura",
  portalStatus: "Estado",
  executingUnit: "Unidad Ejecutora",
  financialAdminService: "Servicio Administrativo Financiero",
} as const;

/** One tender as the portal describes it: every export column, nothing of ours. */
export interface TenderInput {
  processNumber: string;
  fileNumber: string;
  name: string;
  processType: string;
  openingAt: Date;
  portalStatus: string;
  executingUnit: string;
  financialAdminService: string;
}

export type RejectionReason = "missing_number" | "bad_date" | "duplicate_in_file";
export interface RejectedRow {
  /** 1-based spreadsheet line (the header is line 1). */
  line: number;
  reason: RejectionReason;
}

export class TenderSheetError extends Error {
  constructor(
    readonly code: "missing_columns" | "empty",
    readonly detail: string[] = [],
  ) {
    super(`${code}${detail.length ? `: ${detail.join(", ")}` : ""}`);
  }
}

const clean = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * The single key builder for tender identity. The importer, the planner's lookup map and the stored process number all go
 * through it, so a padded or lower-cased number from the portal can never miss its own row and create a twin.
 */
export function tenderKey(processNumber: string): string {
  return clean(processNumber).toUpperCase();
}

const OPENING = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?:\s*Hrs\.?)?$/;

/**
 * "09/12/2026 10:00 Hrs." is day/month/year, Argentina wall-clock time. Parsed by hand: `new Date()` reads it as the 12th of
 * September. Returns null for anything that is not a real calendar date and time (31/02, month 13, hour 25).
 */
export function parseOpeningDate(raw: string): Date | null {
  const m = OPENING.exec(clean(raw));
  if (!m) return null;
  const [day, month, year, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return argentinaWallClockToUtc(`${year}-${pad(month)}-${pad(day)}`, `${pad(hour)}:${pad(minute)}`);
}

export interface ParsedTenderSheet {
  tenders: TenderInput[];
  rejected: RejectedRow[];
}

/** Turns the sheet's cell matrix (header first) into tenders, reporting every row it cannot use. */
export function parseTenderSheet(rows: string[][]): ParsedTenderSheet {
  const header = rows[0]?.map(clean);
  if (!header) throw new TenderSheetError("empty");
  const index = new Map(header.map((title, i) => [title, i]));
  const missing = Object.values(PORTAL_COLUMNS).filter((title) => !index.has(title));
  if (missing.length > 0) throw new TenderSheetError("missing_columns", missing);

  const cell = (row: string[], title: string) => clean(row[index.get(title)!]);
  const tenders: TenderInput[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    if (row.every((c) => clean(c) === "")) return; // blank spacer line, not a lost tender
    const processNumber = tenderKey(cell(row, PORTAL_COLUMNS.processNumber));
    if (!processNumber) return void rejected.push({ line, reason: "missing_number" });
    const openingAt = parseOpeningDate(cell(row, PORTAL_COLUMNS.openingAt));
    if (!openingAt) return void rejected.push({ line, reason: "bad_date" });
    if (seen.has(processNumber)) return void rejected.push({ line, reason: "duplicate_in_file" });
    seen.add(processNumber);
    tenders.push({
      processNumber,
      fileNumber: cell(row, PORTAL_COLUMNS.fileNumber),
      name: cell(row, PORTAL_COLUMNS.name),
      processType: cell(row, PORTAL_COLUMNS.processType),
      openingAt,
      portalStatus: cell(row, PORTAL_COLUMNS.portalStatus),
      executingUnit: cell(row, PORTAL_COLUMNS.executingUnit),
      financialAdminService: cell(row, PORTAL_COLUMNS.financialAdminService),
    });
  });
  return { tenders, rejected };
}
