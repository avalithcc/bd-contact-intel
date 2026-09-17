import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locales";
import { t, type Dictionary } from "./dictionaries";

/** Reads the visitor's locale from the `locale` cookie, server-side only. */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Convenience: current locale's dictionary, resolved from the cookie. */
export async function getDictionary(): Promise<Dictionary> {
  return t(await getLocale());
}
