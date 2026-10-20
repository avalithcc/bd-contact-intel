/**
 * Deterministic, exhaustive scan: which numbers does the compliance resolver's phone link accept that the picker's SQL
 * length floor (PHONE_MIN_LENGTH, pickerQuery.ts) would hide? Pure CPU, no database, no network, no randomness.
 *
 * Method: for every country calling code, try EVERY digit string whose total length (calling code included) is below the
 * floor, parse it with the same libphonenumber-js build the resolver imports (default = `min` metadata), and keep the ones
 * `isValid()` accepts AND that resolve to a country (`parsed.country`, exactly what phoneCountryIso requires). About 10M
 * parses, ~30 s on one core. It proves the SET of calling codes below; it says nothing about whether a hit is a real
 * subscriber number or a non-subscriber special (the library cannot tell).
 *
 * Usage: npx tsx scripts/scan-short-phone-numbers.ts [maxNationalDigits]   (the optional cap makes a quick spot-check)
 * The committed result lives in tests/unit/sequencesPickerQuery.test.ts (SHORT_VALID_WITNESSES).
 */
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { PHONE_MIN_LENGTH } from "../src/lib/sequences/pickerQuery";

export function scanShortValid(maxNational = Infinity): Map<string, { country: string; witness: string }[]> {
  const codes = [...new Set((getCountries() as CountryCode[]).map((c) => getCountryCallingCode(c)))].sort();
  const out = new Map<string, { country: string; witness: string }[]>();
  for (const code of codes) {
    const seen = new Set<string>();
    for (let n = 1; n <= maxNational && code.length + n < PHONE_MIN_LENGTH; n++) {
      for (let i = 0; i < 10 ** n; i++) {
        const number = `+${code}${String(i).padStart(n, "0")}`;
        const parsed = parsePhoneNumberFromString(number);
        if (!parsed?.isValid() || !parsed.country || seen.has(parsed.country)) continue;
        seen.add(parsed.country);
        out.set(code, [...(out.get(code) ?? []), { country: parsed.country, witness: number }]);
      }
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("scan-short-phone-numbers.ts")) {
  const cap = process.argv[2] ? Number(process.argv[2]) : Infinity;
  for (const [code, hits] of scanShortValid(cap)) console.log(code, JSON.stringify(hits));
}
