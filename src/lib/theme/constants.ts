/**
 * Supported UI themes. `system` means "follow the OS/browser preference" —
 * it is a real, storable choice, not just the absence of one.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Light theme is now default, matching Ava Foundry design language. */
export const DEFAULT_THEME: Theme = "light";

/** Cookie used to persist the visitor's chosen theme across requests. */
export const THEME_COOKIE = "theme";

export function isTheme(value: string | null | undefined): value is Theme {
  return !!value && (THEMES as readonly string[]).includes(value);
}
