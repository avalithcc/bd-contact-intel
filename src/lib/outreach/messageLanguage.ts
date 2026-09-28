/**
 * Language the GENERATED MESSAGE ITSELF is written in — distinct from the
 * app's UI locale (`src/lib/i18n/locales.ts`, which is Spanish-only, see
 * D10). Chosen inline in the "Generar mensaje" dialog (owner direction,
 * 2026-09-26: Español / Inglés / Portugués), independent of UI chrome.
 */

export const MESSAGE_LANGUAGES = ["es", "en", "pt"] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];

// Owner direction: Spanish is the default in the dialog.
export const DEFAULT_MESSAGE_LANGUAGE: MessageLanguage = "es";

export function isMessageLanguage(value: string | null | undefined): value is MessageLanguage {
  return !!value && (MESSAGE_LANGUAGES as readonly string[]).includes(value);
}
