/**
 * Supported UI themes. `system` means "follow the OS/browser preference" —
 * it is a real, storable choice, not just the absence of one.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Preserves today's dark-only look for anyone without a saved preference. */
export const DEFAULT_THEME: Theme = "dark";

/** Cookie used to persist the visitor's chosen theme across requests. */
export const THEME_COOKIE = "theme";

export function isTheme(value: string | null | undefined): value is Theme {
  return !!value && (THEMES as readonly string[]).includes(value);
}
