/**
 * Pure parser for the `pdftotext -layout` text of the commercial-contacts PDF
 * (scripts/import-contactos-comerciales-2026-10.ts). No DB access, no PDF
 * dependency.
 *
 * Layout: fixed-width columns NOMBRE | APELLIDO | EMPRESA (POSIBLE) |
 * ÚLTIMO CONTACTO | MAIL | TELÉFONO. The header repeats on every page and the
 * columns shift a few characters per page, so offsets are read from the most
 * recent header line, never hard-coded. A row is a line with an email at the
 * MAIL column; the lines under it (no email) are continuations: a second
 * phone in the TELÉFONO column, a job title in the EMPRESA column (ignored),
 * or the "(inferido del mail)" marker in the APELLIDO column.
 */

export interface ComercialRow {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  /** Raw "ÚLTIMO CONTACTO" cell. Reported only, never written anywhere. */
  lastContact: string | null;
  email: string;
  /** Raw phone cells in file order (main line first, then continuations). */
  phones: string[];
  /** The PDF flagged the name as derived from the email address. */
  nameInferred: boolean;
}

/** The ONE builder of email lookup keys: the planner and the DB read both use it. */
export const emailKey = (email: string): string => email.trim().toLowerCase();

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const DATE_RE = /\d{2}-\d{2}-\d{4}/;
const MARKER_RE = /^\(inferido del mail\)$/i;
const FOOTER_RE = /\d+\s*\/\s*\d+\s*$/;
const DASHES = new Set(["", "—", "–", "-"]);

const cell = (text: string | null | undefined): string | null => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return DASHES.has(t) ? null : t;
};

interface Columns {
  nombre: number;
  apellido: number;
  empresa: number;
  ultimo: number;
  mail: number;
  tel: number;
}

function readHeader(line: string): Columns | null {
  if (!line.includes("NOMBRE") || !line.includes("APELLIDO") || !line.includes("MAIL")) return null;
  return {
    nombre: line.indexOf("NOMBRE"),
    apellido: line.indexOf("APELLIDO"),
    empresa: line.indexOf("EMPRESA"),
    ultimo: line.indexOf("LTIMO"),
    mail: line.indexOf("MAIL"),
    tel: line.search(/TEL.FONO/),
  };
}

export function parseComerciales(text: string): ComercialRow[] {
  const rows: ComercialRow[] = [];
  let cols: Columns | null = null;
  let current: ComercialRow | null = null;

  for (const raw of text.normalize("NFC").split(/\r?\n/)) {
    const header = readHeader(raw);
    if (header) {
      cols = header;
      current = null;
      continue;
    }
    if (!cols || !raw.trim()) continue;
    if (FOOTER_RE.test(raw)) {
      current = null;
      continue;
    }

    const email = EMAIL_RE.exec(raw);
    // Drift tolerance: pdftotext places a cell 0-1 characters left of its header.
    if (email && Math.abs(email.index - cols.mail) <= 2) {
      const surname = cell(raw.slice(cols.apellido - 1, cols.empresa - 1));
      const inferred = surname !== null && MARKER_RE.test(surname);
      const phone = cell(raw.slice(email.index + email[0].length));
      current = {
        firstName: cell(raw.slice(0, cols.apellido - 1)),
        lastName: inferred ? null : surname,
        company: cell(raw.slice(cols.empresa - 1, cols.ultimo - 1)),
        lastContact: DATE_RE.exec(raw.slice(cols.ultimo - 1, cols.mail - 1))?.[0] ?? null,
        email: email[0],
        phones: phone ? [phone] : [],
        nameInferred: inferred,
      };
      rows.push(current);
      continue;
    }
    if (!current) continue;

    // Continuation line: judge each cell by its own column.
    if (raw.slice(0, cols.tel - 2).trim() === "") {
      const phone = cell(raw.slice(cols.tel - 2));
      if (phone) current.phones.push(phone);
    } else if (raw.slice(0, cols.apellido - 2).trim() === "" && MARKER_RE.test(cell(raw.slice(cols.apellido - 2, cols.empresa - 2)) ?? "")) {
      current.nameInferred = true;
    }
  }
  return rows;
}

export interface ComercialPhone {
  /** The dialable part, or null when nothing should be stored. */
  value: string | null;
  extensionDropped: boolean;
  invalid: boolean;
}

const EXTENSION_RE = /\s*\b(?:ext\.?|extension|x)\s*\d+\s*$/i;

/**
 * Keeps the dialable part (the `tel:` link and the WhatsApp shortcut cannot
 * carry an extension), reports that an extension was dropped, and validates
 * with src/lib/phone.ts. A rejected number stores nothing.
 */
export function normalizeComercialPhone(raw: string): ComercialPhone {
  const stripped = raw.replace(EXTENSION_RE, "").replace(/\s+/g, " ").trim();
  return stripped === raw.trim() ? check(stripped, false) : check(stripped, true);
}

import { isValidPhoneFormat } from "@/lib/phone";
function check(value: string, extensionDropped: boolean): ComercialPhone {
  return isValidPhoneFormat(value) ? { value, extensionDropped, invalid: false } : { value: null, extensionDropped: false, invalid: true };
}
