/**
 * Supported UI locales. Presentation-layer only — never affects query
 * logic, filter validation, or stored data (contact/company names, message
 * content, DB filter keys are never translated).
 */

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

// D10 (owner decision, R11): the product ships Spanish-only — there is no
// `LocaleSwitcher` and no cookie-driven locale selection in the UI. `LOCALES`
// still lists both values so the `{ en, es }` dictionary structure and its
// `Dictionary` type stay intact for a cheap future re-add of English, and
// because `isLocale` below is still used to validate the outreach message
// language (a business feature: generated messages may be ES or EN,
// unrelated to the UI chrome locale).
export const DEFAULT_LOCALE: Locale = "es";

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
