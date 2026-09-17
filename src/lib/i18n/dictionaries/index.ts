import type { Locale } from "../locales";
import { en } from "./en";
import { es } from "./es";

export type Dictionary = typeof en;

const DICTIONARIES: Record<Locale, Dictionary> = { en, es };

/**
 * Pure lookup — no server-only APIs — so it can be used from both server
 * and client components. Server components should get `locale` from
 * `getLocale()` (src/lib/i18n/server.ts); client components receive it as
 * a prop from their server-rendered parent.
 */
export function t(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
