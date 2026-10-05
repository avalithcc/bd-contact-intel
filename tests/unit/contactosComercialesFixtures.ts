/**
 * Synthetic `pdftotext -layout` text for the commercial-contacts PDF. Names,
 * emails and numbers are invented; only the LAYOUT (fixed-width columns that
 * shift a few characters from page to page, repeated header, page footer,
 * continuation lines) is copied from the real file.
 */
export type Cols = readonly [nombre: number, apellido: number, empresa: number, ultimo: number, mail: number, tel: number];

export const PAGE_1: Cols = [1, 21, 44, 78, 95, 129];
export const PAGE_2: Cols = [2, 22, 44, 80, 97, 133];

function place(parts: readonly (readonly [number, string])[]): string {
  let out = "";
  for (const [col, text] of parts) out = out.padEnd(col, " ") + text;
  return out;
}

export const header = (c: Cols) =>
  place([[c[0], "NOMBRE"], [c[1], "APELLIDO"], [c[2], "EMPRESA (POSIBLE)"], [c[3], "ÚLTIMO CONTACTO"], [c[4], "MAIL"], [c[5], "TELÉFONO"]]);

export interface Cells {
  first?: string;
  last?: string;
  company?: string;
  date?: string;
  email: string;
  phone?: string;
}

/** `drift` mimics pdftotext placing a cell one column left of the header. */
export function row(c: Cols, cells: Cells, drift = 0): string {
  return place([
    [c[0], cells.first ?? "—"], [c[1], cells.last ?? ""], [c[2], cells.company ?? ""],
    [c[3], cells.date ?? "01-02-2026"], [c[4] - drift, cells.email], [c[5] - drift, cells.phone ?? "—"],
  ]);
}

export const inColumn = (c: Cols, col: 1 | 2 | 5, text: string) => place([[c[col], text]]);

export const footer = (n: number) => `${"Informe · Contactos · 01-02-2026 · Confidencial".padEnd(120)}${n} / 2`;

export const intro = "Resumen: 3 contactos · 1 con teléfono\n  ceo@example.test · 01-02-2026";
