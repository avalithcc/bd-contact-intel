/**
 * Supported UI locales. Presentation-layer only — never affects query
 * logic, filter validation, or stored data (contact/company names, message
 * content, DB filter keys are never translated).
 */

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie used to persist the visitor's chosen locale across requests. */
export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
