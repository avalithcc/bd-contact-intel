/**
 * Vocabulary for `person.contact_type` (migration 0034): the buying role a
 * sales sheet assigns to a person. Validated here, at the write boundary,
 * rather than with a DB CHECK — same convention as `company.relationship_stage`
 * / `company.account_type` (app-validated free text; the repo has no CHECK
 * constraints). Widening the vocabulary is then a code change, not a
 * migration.
 */
export const CONTACT_TYPES = ["BUYER-CHAMPION", "INFLUENCER"] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

/** Display labels (Spanish) — the single place the UI reads them from: list
 * column, filter menu/chip, record page, CSV. Stored values stay as-is. */
export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  "BUYER-CHAMPION": "Comprador / promotor",
  INFLUENCER: "Influenciador",
};

/** Field name shown next to the value (column header, chip, record row). */
export const CONTACT_TYPE_FIELD_LABEL = "Tipo de contacto";

export function isContactType(value: unknown): value is ContactType {
  return typeof value === "string" && (CONTACT_TYPES as readonly string[]).includes(value);
}

/**
 * Plain-text display value. Empty is an em dash (like empty roleGroup/
 * industry/country), never a "sin dato" badge: absence is the normal state of
 * almost every row and not a gap a BD can act on. A stored value outside the
 * vocabulary is shown verbatim rather than hidden.
 */
export function contactTypeLabel(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  return isContactType(value) ? CONTACT_TYPE_LABELS[value] : value;
}

/** Case/whitespace-insensitive; anything outside the vocabulary (including
 * blank) is `null` so the caller decides whether that is an error. */
export function parseContactType(raw: string | null | undefined): ContactType | null {
  const normalized = raw?.trim().toUpperCase();
  if (!normalized) return null;
  return (CONTACT_TYPES as readonly string[]).includes(normalized) ? (normalized as ContactType) : null;
}
