/**
 * Pure CSV parsing for the "para llamar hoteles" sheet (scripts/
 * import-hoteles-2026-10.ts). No DB access; plan.ts consumes the output.
 *
 * Columns are read BY HEADER NAME, never by position. The `Campaigns` column
 * (history from a different outreach tool, owner decision) and the company
 * columns Website / Industry / Number of employees / Company LinkedIn URL /
 * Contact country are never read; `ignoredColumns` reports them so the dry
 * run shows what was left behind.
 */
import { parse } from "csv-parse/sync";
import { normalizeProfileKey } from "@/lib/csv";
import { parseContactType, type ContactType } from "@/lib/contacts/contactType";
import { isValidPhoneFormat } from "@/lib/phone";

export const HOTELES_SOURCE_KEY = "hoteles-2026-10";

const USED_HEADERS = [
  "First name", "Last name", "Company name", "Country", "Job title", "LinkedIn profile URL",
  "Professional email", "Phone number", "Mobile phone", "TYPE OF CONTACT",
] as const;

// ITU dial codes for the countries in this sheet; a number whose code
// disagrees with the row's Country is flagged, never rewritten.
export const DIAL_CODE: Record<string, string> = {
  spain: "34", italy: "39", mexico: "52", "costa rica": "506", argentina: "54", colombia: "57",
};

export interface PhoneResult {
  value: string | null;
  /** What was changed to get `value`; null when stored exactly as entered. */
  normalised: "collapsed_whitespace" | "added_plus" | null;
  rejected: boolean;
  dialMismatch: boolean;
}

const NO_PHONE: PhoneResult = { value: null, normalised: null, rejected: false, dialMismatch: false };

/**
 * Trim + collapse whitespace; add the missing leading `+` ONLY when the digits
 * already start with the row country's dial code (and there are >= 10 of
 * them) — the one rewrite with strong evidence. Everything else is stored as
 * entered (same policy as the DFF import: no guessing a country code).
 */
export function normalizeHotelPhone(raw: string | null | undefined, country: string | null): PhoneResult {
  const collapsed = (raw ?? "").replace(/[\s ]+/g, " ").trim();
  if (!collapsed) return NO_PHONE;
  const dial = country ? DIAL_CODE[country.trim().toLowerCase()] : undefined;
  let value = collapsed;
  let normalised: PhoneResult["normalised"] = collapsed !== (raw ?? "").trim() ? "collapsed_whitespace" : null;
  const digits = collapsed.replace(/\D/g, "");
  if (!collapsed.startsWith("+") && dial && digits.startsWith(dial) && digits.length >= 10) {
    value = `+${collapsed}`;
    normalised = "added_plus";
  }
  if (!isValidPhoneFormat(value)) return { value: null, normalised: null, rejected: true, dialMismatch: false };
  const dialMismatch = !!dial && !value.replace(/\D/g, "").startsWith(dial);
  return { value, normalised, rejected: false, dialMismatch };
}

export interface HotelRow {
  /** 1-based data row (the header is row 0) — how the owner finds it in the sheet. */
  line: number;
  firstName: string;
  lastName: string;
  company: string | null;
  country: string | null;
  jobTitle: string | null;
  contactType: ContactType;
  email: string | null;
  emailNormalized: string | null;
  /** Raw LinkedIn URL; the matcher/db normalise it via normalizeProfileKey. */
  profileUrl: string | null;
  profileKey: string | null;
  phone: PhoneResult;
  mobilePhone: PhoneResult;
}

export interface RowSkip {
  line: number;
  reason: "no_name" | "invalid_contact_type";
}

export interface ParsedHotelSheet {
  rowsRead: number;
  rows: HotelRow[];
  skipped: RowSkip[];
  ignoredColumns: string[];
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const blank = (v: string | undefined): string | null => (v?.trim() ? v.trim() : null);

export function parseHotelRows(csvText: string): ParsedHotelSheet {
  const records = parse(csvText, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as Record<string, string>[];
  const headers = records.length ? Object.keys(records[0]!) : [];
  const missing = USED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) throw new Error(`CSV is missing expected column(s): ${missing.join(", ")}`);

  const rows: HotelRow[] = [];
  const skipped: RowSkip[] = [];
  records.forEach((r, i) => {
    const line = i + 1;
    const firstName = blank(r["First name"]);
    const lastName = blank(r["Last name"]);
    if (!firstName || !lastName) return void skipped.push({ line, reason: "no_name" });
    const contactType = parseContactType(r["TYPE OF CONTACT"]);
    if (!contactType) return void skipped.push({ line, reason: "invalid_contact_type" });
    const country = blank(r["Country"]);
    const rawEmail = blank(r["Professional email"]);
    // A malformed address is treated as no email (keyed by LinkedIn instead).
    const email = rawEmail && EMAIL_RE.test(rawEmail) ? rawEmail : null;
    const profileUrl = blank(r["LinkedIn profile URL"]);
    rows.push({
      line, firstName, lastName, country, contactType, email,
      company: blank(r["Company name"]),
      jobTitle: blank(r["Job title"]),
      emailNormalized: email ? email.toLowerCase() : null,
      profileUrl,
      profileKey: profileUrl ? normalizeProfileKey(profileUrl) : null,
      phone: normalizeHotelPhone(r["Phone number"], country),
      mobilePhone: normalizeHotelPhone(r["Mobile phone"], country),
    });
  });
  return { rowsRead: records.length, rows, skipped, ignoredColumns: headers.filter((h) => !(USED_HEADERS as readonly string[]).includes(h)) };
}
