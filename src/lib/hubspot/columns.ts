/**
 * Pinned HubSpot export header names (Spanish, from the real export files —
 * see hubspot/todos-contactos.csv and hubspot/todos-empresas.csv, header
 * line only; column names are not PII, per design D2/D8).
 *
 * These are the columns the H1 mappers (src/lib/hubspot/contacts.ts,
 * companies.ts) read. The exports carry 268 (contacts) / 209 (companies)
 * columns in total — only the ones this import actually maps are pinned
 * here; unused columns are ignored by the projection in parse.ts.
 */

export const REQUIRED_CONTACT_HEADERS: readonly string[] = [
  "ID de registro",
  "Nombre",
  "Apellidos",
  "Correo",
  "Cargo",
  "Ciudad",
  "País/región",
  "Número de teléfono",
  "Propietario del contacto",
  "Número de veces contactado",
  "Último contacto",
  "Última actividad",
  "Fecha de creación",
  "Estado del lead",
  "Associated Company IDs (Primary)",
];

/**
 * LinkedIn profile URL, in preference order (contacts.ts reads both and
 * takes the first non-blank — the real export has "LinkedIn" ~0.6% filled
 * and "URL de LinkedIn" ~0% filled, so neither alone is a reliable source).
 * Pinned for documentation/tests only — deliberately NOT part of
 * `REQUIRED_CONTACT_HEADERS`, since a row can be mapped without either.
 */
export const OPTIONAL_CONTACT_LINKEDIN_HEADERS: readonly string[] = ["LinkedIn", "URL de LinkedIn"];

export const REQUIRED_COMPANY_HEADERS: readonly string[] = [
  "ID de registro",
  "Nombre de la empresa",
  "Nombre de dominio de la empresa",
  "Dominios adicionales",
  "Associated Note",
  "Ciudad",
  "País/región",
  "Sector",
];

/** NFC-compose + trim, so headers that differ only by Unicode form or
 * incidental whitespace still match the pinned names above. */
function normalizeHeader(value: string): string {
  return value.normalize("NFC").trim();
}

/**
 * Throws listing the missing header NAMES (never row data) when any
 * `required` header is absent from `actualHeaders`. Header strings are not
 * PII, so they are safe to include verbatim in the error message.
 */
export function assertRequiredHeaders(actualHeaders: string[], required: readonly string[]): void {
  const normalizedActual = new Set(actualHeaders.map(normalizeHeader));
  const missing = required.filter((name) => !normalizedActual.has(normalizeHeader(name)));
  if (missing.length > 0) {
    throw new Error(`HubSpot export is missing required column(s): ${missing.join(", ")}`);
  }
}
