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

/**
 * The single number the contacts list (and its CSV export) shows: `phone`
 * first, then `mobilePhone`. The order is a PRODUCT DECISION, not an
 * accident: it matches the record page's Teléfono-then-Móvil order, and
 * preferring mobile is a one-line flip of the array below.
 *
 * Blank strings are skipped so a stray "" never shadows a real number.
 * Malformed values are kept (shown as plain text) because the "Tiene
 * teléfono" filter counts any non-null value — the cell must never be empty
 * for a row that filter keeps.
 */
export function pickListPhone(phone: string | null, mobilePhone: string | null): string | null {
  for (const candidate of [phone, mobilePhone]) {
    if (candidate && candidate.trim() !== "") return formatPhoneForDisplay(candidate);
  }
  return null;
}

// E.164: a number is at most 15 digits, country code included.
const MAX_INTERNATIONAL_DIGITS = 15;
// Shortest international number worth linking (country code included). The
// `tel:` link keeps the looser MIN_DIGITS floor: a short internal number can
// still be called, but "+123456" is not a number WhatsApp can open.
const MIN_WHATSAPP_DIGITS = 8;

export type WhatsappLinkReason =
  /** Blank, missing or malformed: shown as plain text, nothing to explain. */
  | "invalid"
  /** A valid number with neither `+` nor `00`: no country is assumed. */
  | "no_country_code"
  /** Carries a country code, but no safe link can be built from it. */
  | "unsupported";

export type WhatsappLink = { url: string; reason?: undefined } | { url: null; reason: WhatsappLinkReason };

/**
 * Argentine mobiles are often written "+54 <area> 15 <number>". The WhatsApp
 * form is "+54 9 <area> <number>": "15" and "9" are mutually exclusive, so
 * linking the digits as typed opens a number that does not exist. Detected
 * narrowly (12 national digits, not starting with 9, a 2-4 digit area code
 * followed by 15) and REFUSED, not converted: converting would be the first
 * step towards reimplementing a phone library.
 */
function isArgentineMobile15(digits: string): boolean {
  if (!digits.startsWith("54")) return false;
  const national = digits.slice(2);
  if (national.length !== 12 || national.startsWith("9")) return false;
  return [2, 3, 4].some((areaLength) => national.slice(areaLength, areaLength + 2) === "15");
}

/**
 * The `https://wa.me/<digits>` link for a stored number, or the reason none
 * can be built. One rule, one place: the UI picks its copy from `reason`
 * instead of restating the condition.
 *
 * A link needs the country code, and numbers are stored as typed, so only
 * two explicit signals count: a leading `+`, or the `00` international
 * prefix (stripped). `011 4123-4567` is a valid stored number but carries
 * neither, and no country is assumed for it (`no_country_code`).
 *
 * `invalid`: blank or failing `isValidPhoneFormat` (the `toTelHref` gate).
 * `unsupported`: fewer than 8 or more than 15 digits, a country code
 * starting with 0, a `(0)` trunk digit (dropping it would be a guess), or an
 * Argentine "15" mobile.
 *
 * The result says nothing about whether the number is registered on
 * WhatsApp; the CRM cannot know that.
 *
 * KNOWN LIMITS (they produce a WRONG link; each is pinned in
 * tests/unit/phone.test.ts so a future parser shows exactly what changes).
 * None can be detected without per-country metadata, i.e. a parsing library:
 * - A glued extension ("+54 11 4123-4567 214"): the 214 is
 *   indistinguishable from subscriber digits.
 * - A trunk 0 written without "(0)" ("+54 011 ...", "+44 020 ..."): some
 *   countries drop it, Italy keeps it ("+39 06 ..."), so no blanket rule.
 * - Other exit codes ("0011 61 2 ..." in Australia, "011" in the US): only
 *   "+" and "00" are recognised; "0011" is read as "00" + "11 ...".
 * - A doubled country code ("+54 54 11 ..."): looks like a longer number.
 */
export function whatsappLink(raw: string | null | undefined): WhatsappLink {
  if (raw == null) return { url: null, reason: "invalid" };
  const trimmed = raw.trim();
  if (!isValidPhoneFormat(trimmed)) return { url: null, reason: "invalid" };
  let digits = trimmed.replace(/[^0-9]/g, "");
  if (!trimmed.startsWith("+")) {
    if (!digits.startsWith("00")) return { url: null, reason: "no_country_code" };
    digits = digits.slice(2);
  }
  if (/\(0\)/.test(trimmed)) return { url: null, reason: "unsupported" };
  if (
    digits.startsWith("0") ||
    digits.length < MIN_WHATSAPP_DIGITS ||
    digits.length > MAX_INTERNATIONAL_DIGITS ||
    isArgentineMobile15(digits)
  ) {
    return { url: null, reason: "unsupported" };
  }
  return { url: `https://wa.me/${digits}` };
}

/** The `wa.me` URL, or `null` for every reason `whatsappLink` can give. */
export function whatsappLinkFor(raw: string | null | undefined): string | null {
  return whatsappLink(raw).url;
}
