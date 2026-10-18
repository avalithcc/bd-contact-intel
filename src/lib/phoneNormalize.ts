import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Pure E.164 normalizer for `person.phone` / `person.mobile_phone`. Server-only: the `max` metadata must stay out of
 * the client bundle that imports src/lib/phone.ts. A value is rewritten only when libphonenumber calls the result
 * valid; everything else is `flagged` and the caller leaves the stored text alone.
 */

export type PhoneColumn = "phone" | "mobilePhone";

export interface PhoneContext {
  column: PhoneColumn;
  /** `person.source_key`. */
  source?: string | null;
  /** `person.country`, free text. */
  country?: string | null;
  /** ISO 3166-1 alpha-2 the data provider reported for this very number (Lusha `countryIso2`). */
  countryIso2?: string | null;
}

export type PhoneRule =
  | "already_e164"
  | "separators_stripped"
  | "intl_00_prefix"
  | "ar_mobile_local"
  | "ar_phone_local"
  | "country_code_prefixed"
  /** A national number made valid by the provider-reported country. */
  | "provider_country";

export type PhoneFlagReason =
  | "empty"
  /** Letters, extension markers or other characters a number never has. */
  | "text_or_extension"
  | "multiple_numbers"
  | "misplaced_plus"
  | "too_few_digits"
  | "too_many_digits"
  | "invalid_number"
  | "possible_not_valid"
  /** The library would rewrite the digits (trunk `0`, ...): not a pure strip. */
  | "needs_review"
  /** Digits only, no recognizable country code and no Argentine context. */
  | "no_country_code"
  /** Argentine context, but the area code is unknown or absent (e.g. `15…`). */
  | "ar_area_code_unknown"
  /** Digits-only value whose country code is a guess: from the Argentine DFF source, or +1/Peru without a matching person country. */
  | "ambiguous_country";

export type PhoneNormalization = { value: string; rule: PhoneRule } | { flagged: true; reason: PhoneFlagReason };

export const DFF_2026_SOURCE_KEY = "dff-2026";

const E164_RE = /^\+[1-9][0-9]{6,14}$/;
const SEPARATORS_RE = /[\s().-]/g;
const MIN_DIGITS = 6;
const MAX_DIGITS = 15;
const AR_LOCAL_LENGTH = 10;

/** Calling codes that are "obvious" for a digits-only value (Latin America, North America, Iberia, Italy, UK, FR, DE). Validity and exact length are still checked. */
const OBVIOUS_CALLING_CODES = ["1", "33", "34", "39", "44", "49", "51", "52", "54", "55", "56", "57", "58", "351", "502", "503", "504", "505", "506", "507", "591", "593", "595", "598"];

function foldCountry(country: string): string {
  return country.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Argentine context: the DFF 2026 import, or a person recorded in Argentina. */
export function isArgentineContext(source: string | null | undefined, country: string | null | undefined, countryIso2?: string | null): boolean {
  if (source === DFF_2026_SOURCE_KEY || countryIso2 === "AR") return true;
  if (!country) return false;
  const folded = foldCountry(country);
  return folded === "argentina" || folded === "ar";
}

function validE164(candidate: string): boolean {
  const parsed = parsePhoneNumberFromString(candidate);
  return parsed !== undefined && parsed.number === candidate && parsed.isValid();
}

/** Why a `+digits` candidate is not storable. Only `possible_not_valid`/`needs_review`/`invalid_number` can come out. */
function whyNotValid(candidate: string): PhoneFlagReason {
  const parsed = parsePhoneNumberFromString(candidate);
  if (!parsed) return "invalid_number";
  if (parsed.number !== candidate) return "needs_review";
  return parsed.isPossible() ? "possible_not_valid" : "invalid_number";
}

const CORROBORATING_COUNTRIES: Record<string, readonly string[]> = {
  US: ["united states", "usa", "us", "estados unidos", "eeuu", "ee.uu."],
  CA: ["canada", "ca"],
  PE: ["peru", "pe"],
};

/** A digits-only value is not trusted when its source is Argentine (DFF) or when it reads as +1 / Peru and the person's country does not say so. */
function isAmbiguousCountry(candidate: string, ctx: PhoneContext): boolean {
  if (ctx.source === DFF_2026_SOURCE_KEY) return true;
  const parsed = parsePhoneNumberFromString(candidate);
  if (parsed?.countryCallingCode !== "1" && parsed?.country !== "PE") return false;
  const names = CORROBORATING_COUNTRIES[parsed.country ?? ""] ?? [];
  return !ctx.country || !names.includes(foldCountry(ctx.country));
}

export function normalizePhone(raw: string, ctx: PhoneContext): PhoneNormalization {
  // "(+54) 9 11 ..." is a country code in parens, not a misplaced plus.
  const trimmed = raw.trim().replace(/^\(\s*(\+[0-9\s]+)\)/, "$1");
  if (trimmed === "") return { flagged: true, reason: "empty" };
  if (E164_RE.test(trimmed)) return { value: trimmed, rule: "already_e164" };

  if (/[0-9)]\s*[/;,]\s*[(+0-9]|[0-9)]\s+[yYeE]\s+[(+0-9]/.test(trimmed) || (trimmed.match(/\+/g) ?? []).length > 1) return { flagged: true, reason: "multiple_numbers" };
  if (!/^[0-9\s().+-]+$/.test(trimmed)) return { flagged: true, reason: "text_or_extension" };
  if (trimmed.lastIndexOf("+") > 0) return { flagged: true, reason: "misplaced_plus" };

  const compact = trimmed.replace(SEPARATORS_RE, "");
  const digits = compact.replace(/^\+/, "");
  if (digits.length < MIN_DIGITS) return { flagged: true, reason: "too_few_digits" };
  if (digits.length > MAX_DIGITS + 2) return { flagged: true, reason: "too_many_digits" };

  if (compact.startsWith("+")) {
    const candidate = `+${digits}`;
    return validE164(candidate) ? { value: candidate, rule: "separators_stripped" } : { flagged: true, reason: whyNotValid(candidate) };
  }

  if (digits.startsWith("00")) {
    const candidate = `+${digits.slice(2)}`;
    return validE164(candidate) ? { value: candidate, rule: "intl_00_prefix" } : { flagged: true, reason: whyNotValid(candidate) };
  }

  if (isArgentineContext(ctx.source, ctx.country, ctx.countryIso2) && digits.length === AR_LOCAL_LENGTH && !digits.startsWith("0")) {
    const mobile = ctx.column === "mobilePhone";
    const candidate = mobile ? `+549${digits}` : `+54${digits}`;
    if (validE164(candidate)) return { value: candidate, rule: mobile ? "ar_mobile_local" : "ar_phone_local" };
    return { flagged: true, reason: "ar_area_code_unknown" };
  }

  if (!digits.startsWith("0") && OBVIOUS_CALLING_CODES.some((code) => digits.startsWith(code))) {
    const candidate = `+${digits}`;
    if (validE164(candidate)) {
      return isAmbiguousCountry(candidate, ctx) ? { flagged: true, reason: "ambiguous_country" } : { value: candidate, rule: "country_code_prefixed" };
    }
    const provider = providerCountryNumber(digits, ctx);
    if (provider) return provider;
    return { flagged: true, reason: whyNotValid(candidate) === "possible_not_valid" ? "possible_not_valid" : "no_country_code" };
  }
  return providerCountryNumber(digits, ctx) ?? { flagged: true, reason: "no_country_code" };
}

/** A national number read in the country the provider reported for it; null unless libphonenumber calls the result valid. */
function providerCountryNumber(digits: string, ctx: PhoneContext): PhoneNormalization | null {
  if (!ctx.countryIso2) return null;
  const parsed = parsePhoneNumberFromString(digits, ctx.countryIso2 as CountryCode);
  return parsed?.isValid() ? { value: parsed.number, rule: "provider_country" } : null;
}

/**
 * The value to STORE for a phone typed or imported: the E.164 form when
 * `normalizePhone` accepts it, else exactly what came in. A value that cannot
 * be normalized is never rejected here (rule 5): validation, where it exists,
 * stays with isValidPhoneFormat.
 */
export function normalizePhoneForWrite<T extends string | null | undefined>(raw: T, ctx: PhoneContext): T | string {
  if (raw === null || raw === undefined) return raw;
  const result = normalizePhone(raw, ctx);
  return "flagged" in result ? raw : result.value;
}
