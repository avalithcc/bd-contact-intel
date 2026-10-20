/**
 * Language the GENERATED MESSAGE ITSELF is written in — distinct from the
 * app's UI locale (`src/lib/i18n/locales.ts`, which is Spanish-only, see
 * D10). Chosen inline in the "Generar mensaje" dialog (owner direction,
 * 2026-09-26: Español / Inglés / Portugués), independent of UI chrome.
 */

import type { Locale } from "@/lib/i18n/locales";

export const MESSAGE_LANGUAGES = ["es", "en", "pt"] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];

// Owner direction: Spanish is the default in the dialog.
export const DEFAULT_MESSAGE_LANGUAGE: MessageLanguage = "es";

export function isMessageLanguage(value: string | null | undefined): value is MessageLanguage {
  return !!value && (MESSAGE_LANGUAGES as readonly string[]).includes(value);
}

/**
 * The language of a recipient-facing PAGE (a UI dictionary) for the language their email was written in.
 *
 * TOTAL on purpose, not a cast and not `?? "en"`. Each MessageLanguage maps to the Locale of the same name when a
 * dictionary exists for it, and to "en" only while it has none: that is `pt` today (owner decision: Brazil gets English).
 * The mapped type makes that a compile-time rule: the day "pt" joins `LOCALES`, `pt: "en"` stops compiling and forces
 * `pt: "pt"`, and a new MessageLanguage with no entry here fails too. A defaulted lookup would instead keep serving
 * those recipients an English opt-out page, silently.
 */
type PageLocaleFor = { readonly [L in MessageLanguage]: L extends Locale ? L : "en" };
const PAGE_LOCALE: PageLocaleFor = { es: "es", en: "en", pt: "en" };

export function localeForMessageLanguage(language: MessageLanguage): Locale {
  return PAGE_LOCALE[language];
}
