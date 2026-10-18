/**
 * Splits a free-text location ("Buenos Aires, Argentina") into `person.city` and `person.country`.
 * The country is taken ONLY when the last comma-separated token is a country this app already recognizes
 * (src/lib/hiring/markets.ts); otherwise the whole text goes into the city. Never guesses. Pure, no I/O.
 */
import { isKnownCountryName } from "@/lib/hiring/markets";

export interface SplitLocation {
  city: string | null;
  country: string | null;
}

export function splitLocation(raw: string | null | undefined): SplitLocation {
  const text = raw?.trim().replace(/\s+/g, " ") ?? "";
  if (!text) return { city: null, country: null };
  const tokens = text
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (last && isKnownCountryName(last)) {
    const city = tokens.slice(0, -1).join(", ");
    return { city: city || null, country: last };
  }
  return { city: text, country: null };
}
