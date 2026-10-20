/**
 * The fourth and last link of the compliance audience (complianceAudience.ts): the country a phone's dial code points at. Pure, no database.
 *
 * It exists because 870 contacts (measured 2026-10-20) have no country anywhere, yet a mobile or phone number that names
 * one, and the create-sequence picker blocked them for a missing legal footer. The inference is for the COMPLIANCE MARKET
 * ONLY and is never stored: person.country also drives send-time zone resolution (sendSchedule/zones.ts), and a guessed
 * country written there would silently reschedule mail.
 *
 * The country is read with libphonenumber-js, not by string-matching a prefix: `parsed.isValid() && parsed.country`, so a
 * truncated or malformed number resolves nothing. `mobile_phone` is tried before `phone` (that ordering produced the 870).
 * A number the parser cannot place (no leading `+`, blank, garbage) is simply no signal and the contact stays blocked.
 *
 * SQL cannot run libphonenumber, so the picker query (pickerQuery.ts) gets the same rule as data: `phoneCallingCodes` lists
 * the dial codes that place a number in any country at all.
 */
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * The ISO code of the country the first usable number (mobile, then phone) belongs to, or null when none places one.
 * The compliance resolver reads this directly: going through a display name and back would add an ICU dependency to a
 * jurisdiction check for no gain.
 */
export function phoneCountryIso(mobilePhone: string | null | undefined, phone: string | null | undefined): string | null {
  for (const raw of [mobilePhone, phone]) {
    const value = raw?.trim();
    if (!value) continue;
    const parsed = parsePhoneNumberFromString(value);
    if (parsed?.isValid() && parsed.country) return parsed.country;
  }
  return null;
}

/**
 * Every country calling code libphonenumber knows (digits, no `+`), sorted. Calling codes are prefix-free (ITU), and +1 is
 * the whole North American plan under the bare `1`, so a prefix test on this list says "the dial code places the number in
 * SOME country" and nothing more. That is all the SQL pre-filter needs: since the compliance audience gives every located
 * country an address, the question the SQL asks is no longer "which market" but "is there a plausible E.164 at all".
 * It deliberately does NOT know which countries the audience holds (the sanctions list lives only in complianceAudience.ts,
 * see pickerQuery.ts `buildPhoneLocatedPattern`): the SQL may show a row JS then holds, never hide one JS would admit.
 */
export function phoneCallingCodes(): string[] {
  return [...new Set((getCountries() as CountryCode[]).map((iso) => getCountryCallingCode(iso)))].sort();
}
