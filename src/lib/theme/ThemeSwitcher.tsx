import { setTheme } from "./actions";
import { THEMES, type Theme } from "./constants";
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Light | Dark | System switcher rendered in the user menu dropdown, below
 * the language switcher. A server component: no client JS is required,
 * since it's a plain form posting to a server action that sets the theme
 * cookie (see actions.ts) — mirrors LocaleSwitcher.tsx.
 */
export function ThemeSwitcher({ theme, locale }: { theme: Theme; locale: Locale }) {
  const dict = t(locale);
  return (
    <form action={setTheme} className="theme-switcher">
      {THEMES.map((th) => (
        <button
          key={th}
          type="submit"
          name="theme"
          value={th}
          className={`secondary-btn theme-btn${th === theme ? " active" : ""}`}
          aria-current={th === theme ? "true" : undefined}
        >
          {dict.themeName[th]}
        </button>
      ))}
    </form>
  );
}
