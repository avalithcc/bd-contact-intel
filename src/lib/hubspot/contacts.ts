/**
 * Pure row -> typed HubSpotContactRow mapper (design D2). Trims strings,
 * turns blanks into null, parses integers/dates, and normalizes bare-domain
 * LinkedIn URLs. No DB dependency — see src/lib/hubspot/parse.ts for the
 * CSV -> Record<string,string> projection this reads from, and
 * src/lib/hubspot/columns.ts for the pinned header names used as keys.
 */

export interface HubSpotContactRow {
  hubspotContactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  ownerRaw: string | null;
  timesContacted: number;
  lastContactAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date | null;
  leadStatus: string | null;
  associatedCompanyIdPrimary: string | null;
}

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** First non-blank value among `values`, trimmed. `undefined` when every
 * value is blank or absent. */
function firstNonBlank(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function parseIntField(value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) return 0;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseDateField(value: string | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Prefixes a bare-domain HubSpot LinkedIn URL with `https://`, so every
 * URL this import stores is directly usable as a link. */
function normalizeUrl(value: string | undefined): string | null {
  const trimmed = blank(value);
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function mapHubSpotContactRow(row: Record<string, string>): HubSpotContactRow {
  return {
    hubspotContactId: row["ID de registro"]!.trim(),
    firstName: blank(row["Nombre"]),
    lastName: blank(row["Apellidos"]),
    email: blank(row["Correo"])?.toLowerCase() ?? null,
    jobTitle: blank(row["Cargo"]),
    city: blank(row["Ciudad"]),
    country: blank(row["País/región"]),
    phone: blank(row["Número de teléfono"]),
    // Preference order: "LinkedIn" (~0.6% filled, the real export's usable
    // column), then "URL de LinkedIn" (~0% filled) — see design/columns.ts.
    linkedinUrl: normalizeUrl(firstNonBlank(row["LinkedIn"], row["URL de LinkedIn"])),
    ownerRaw: blank(row["Propietario del contacto"]),
    timesContacted: parseIntField(row["Número de veces contactado"]),
    lastContactAt: parseDateField(row["Último contacto"]),
    lastActivityAt: parseDateField(row["Última actividad"]),
    createdAt: parseDateField(row["Fecha de creación"]),
    leadStatus: blank(row["Estado del lead"]),
    associatedCompanyIdPrimary: blank(row["Associated Company IDs (Primary)"]),
  };
}
