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

/** Case/whitespace-insensitive; anything outside the vocabulary (including
 * blank) is `null` so the caller decides whether that is an error. */
export function parseContactType(raw: string | null | undefined): ContactType | null {
  const normalized = raw?.trim().toUpperCase();
  if (!normalized) return null;
  return (CONTACT_TYPES as readonly string[]).includes(normalized) ? (normalized as ContactType) : null;
}
