/**
 * The fourth and last link of recipientMarket: the country a phone's dial code points at. Pure, no database.
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
 * SQL cannot run libphonenumber, so the picker query (pickerQuery.ts) gets the same rule as data: `phoneCallingCodeGroups`
 * derives, from the SAME classification the other links use, which calling codes land in a market that has a footer.
 */
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import type { MarketKey } from "@/lib/hiring/markets";

/**
 * Region names that classifyMarket would misread, because the name is also a US state. Georgia (+995) is the one the
 * enumeration test found: "georgia" is a US_RULES phrase, so +995 would have earned the US footer. For these the bare ISO
 * code stands in as the "name", which no market rule matches, so the number resolves `other`.
 */
const NAME_COLLIDES_WITH_US_STATE: ReadonlySet<string> = new Set(["GE"]);

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** The English name of an ISO country, in the form `classifyMarket` reads ("Dominican Republic", "Brazil"). */
export function countryNameOf(iso: string): string {
  return NAME_COLLIDES_WITH_US_STATE.has(iso) ? iso : (regionNames.of(iso) ?? iso);
}

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

/** The name of the country the first usable number (mobile, then phone) belongs to, or null when none places one. */
export function phoneCountryName(mobilePhone: string | null | undefined, phone: string | null | undefined): string | null {
  const iso = phoneCountryIso(mobilePhone, phone);
  return iso ? countryNameOf(iso) : null;
}

/**
 * +1 is shared by the whole North American plan, so the calling code alone cannot name a country. The United States and
 * Canada are bare `1`; the Dominican Republic is `1809|1829|1849` (its area codes). Any other mapped country with code 1
 * and no entry here would fall back to bare `1`.
 */
const NANP_AREA_CODES: Readonly<Record<string, readonly string[]>> = { DO: ["809", "829", "849"] };

export type CallingCodeGroups = { latam: string[]; us: string[] };

/**
 * The dial-code prefixes (digits, no `+`) of every country `marketOf` puts in `latam` or `us`, i.e. the countries with a
 * legal footer. `marketOf` is the same country classification recipientMarket uses, so Canada and the name lists behave
 * identically here. Calling codes are prefix-free (ITU), except the NANP split above, so a prefix test never confuses two
 * countries. SQL-side this is nearly a superset of what libphonenumber accepts: it cannot validate a number, and bare `1` also
 * covers NANP countries with no footer (Jamaica, the Bahamas...). That direction only shows a row that the JS admission then
 * blocks with its reason. The reverse (SQL hiding a row JS would allow) is guarded, not impossible by construction: the SQL
 * folds the digit scripts libphonenumber accepts (pickerQuery.ts `phoneDigits`) and its length floor is checked against every
 * country's example number. A format libphonenumber accepts that neither covers would be hidden.
 */
export function phoneCallingCodeGroups(marketOf: (countryName: string) => MarketKey): CallingCodeGroups {
  const groups: Record<"latam" | "us", Set<string>> = { latam: new Set(), us: new Set() };
  for (const iso of getCountries() as CountryCode[]) {
    const market = marketOf(countryNameOf(iso));
    if (market === "other") continue;
    const code = getCountryCallingCode(iso);
    const areas = NANP_AREA_CODES[iso];
    for (const prefix of code === "1" && areas ? areas.map((area) => `1${area}`) : [code]) groups[market].add(prefix);
  }
  return { latam: [...groups.latam].sort(), us: [...groups.us].sort() };
}
