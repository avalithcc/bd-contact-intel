/**
 * Pure phone display/`tel:`/validation helper (migration 0016; contact-record
 * mockup: "Teléfono"/"Móvil" property rows are `tel:` links with inline
 * edit). No DB access — property-edit validation (propertyEdit.ts) and the
 * record page's `tel:` href both go through this module so display, storage
 * and dialing can never disagree on what counts as a phone number.
 *
 * International formats are allowed (owner: "allow international formats"),
 * so this deliberately does NOT enforce a fixed digit count or country
 * prefix — only that the value looks like a phone number: digits, spaces,
 * dashes and parens, with an optional leading `+`, and at least 6 digits
 * total (rejects obvious non-numbers like a 3-digit extension typo without
 * being so strict it rejects a real short-country-code international
 * number).
 */

const ALLOWED_CHARS_RE = /^\+?[0-9 ()-]+$/;
const MIN_DIGITS = 6;

function countDigits(value: string): number {
  return (value.match(/[0-9]/g) ?? []).length;
}

/** Trims `raw`; a trimmed empty string is always invalid (use a separate
 * "clear the field" affordance, not an empty phone value). */
export function isValidPhoneFormat(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  if (!ALLOWED_CHARS_RE.test(trimmed)) return false;
  // A `+` is only valid as the very first character (international prefix).
  if (trimmed.indexOf("+") > 0) return false;
  return countDigits(trimmed) >= MIN_DIGITS;
}

/** Trims `raw`, preserving the entered format otherwise — no reformatting,
 * so the BD's own entry (e.g. "011 4123-4567" vs "+54 11 4123-4567") is what
 * renders back. */
export function formatPhoneForDisplay(raw: string): string {
  return raw.trim();
}

/** Strips everything but digits and a leading `+`, for a `tel:` href. Returns
 * `null` for a value that doesn't pass `isValidPhoneFormat` — the record
 * page then renders it as plain text instead of a dead/misleading link. */
export function toTelHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isValidPhoneFormat(trimmed)) return null;
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^0-9]/g, "");
  return `tel:${plus}${digits}`;
}
