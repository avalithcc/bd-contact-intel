import { DEFAULT_LOCALE, type Locale } from "./locales";
import { t, type Dictionary } from "./dictionaries";

/**
 * The app's locale, server-side only. D10 (owner decision, R11): the
 * product ships Spanish-only — no `LocaleSwitcher`, no cookie-driven
 * locale selection. The `{ en, es }` dictionary structure (and this
 * return type) is kept so English can be re-added cheaply later, but
 * nothing in the UI resolves to it today.
 */
export async function getLocale(): Promise<Locale> {
  return DEFAULT_LOCALE;
}

/** Convenience: the current (Spanish-only) locale's dictionary. */
export async function getDictionary(): Promise<Dictionary> {
  return t(await getLocale());
}
