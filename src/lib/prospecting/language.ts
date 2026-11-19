/**
 * Which language an AUTO-generated prospecting draft is written in. DB-free and free of the phone parser, so any client may import it.
 *
 * The language comes from the PERSON's own country (`person.country`), never the company's. Measured 2026-11-19 over people with a
 * verified email: 761 of 3,527 differ from their company's country (22%). This repo already lost 357 contacts to a company country
 * deciding each employee's email language (a multinational is filed in one country and its people sit in others), so do not
 * "simplify" this back to the company.
 *
 * There is NO fallback. No country, or a country in neither list (Germany, India, Brazil...), is a refusal recorded with its reason:
 * no human reads this draft before it is written, and a guessed language is the failure being fixed. Do not re-introduce a default
 * one level down. A declared `preferred_language` (2 of 5,304 people have one) still wins.
 *
 * `person.country` holds display names ("United States", "Argentina"), not ISO codes. `resolveCountry` matches the whole string,
 * case- and accent-insensitively, against English and Spanish names, so the lists below are explicit ISO sets and nothing else
 * decides a language. A name it cannot resolve to exactly one country resolves to nothing, which refuses.
 */
import { resolveCountry } from "@/lib/sequences/countryNames";
import { isMessageLanguage, type MessageLanguage } from "@/lib/outreach/messageLanguage";

/** Deliberately not Canada: Quebec makes one country field unable to pick a language, and a guess here is a refusal. */
export const ENGLISH_LANGUAGE_COUNTRIES: ReadonlySet<string> = new Set(["US", "GB", "IE", "AU", "NZ"]);

/** Brazil is NOT here: it is Portuguese, and this path has no Portuguese draft, so it refuses. */
export const SPANISH_LANGUAGE_COUNTRIES: ReadonlySet<string> = new Set([
  "AR", "BO", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GQ", "GT", "HN", "MX", "NI", "PA", "PY", "PE", "PR", "ES", "UY", "VE",
]);

export function resolveProspectLanguage(preferredLanguage: string | null | undefined, country: string | null | undefined): MessageLanguage | null {
  if (isMessageLanguage(preferredLanguage)) return preferredLanguage;
  const iso = resolveCountry(country);
  if (!iso) return null;
  if (ENGLISH_LANGUAGE_COUNTRIES.has(iso)) return "en";
  if (SPANISH_LANGUAGE_COUNTRIES.has(iso)) return "es";
  return null;
}
