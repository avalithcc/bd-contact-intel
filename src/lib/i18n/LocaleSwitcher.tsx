import { setLocale } from "./actions";
import { LOCALES, type Locale } from "./locales";
import { t } from "./dictionaries";

/**
 * EN | ES switcher rendered in every page header. A server component: no
 * client JS is required, since it's a plain form posting to a server
 * action that sets the locale cookie (see actions.ts).
 */
export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const dict = t(locale);
  return (
    <form action={setLocale} className="locale-switcher">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="submit"
          name="locale"
          value={l}
          className={`secondary-btn locale-btn${l === locale ? " active" : ""}`}
          aria-current={l === locale ? "true" : undefined}
        >
          {dict.localeName[l]}
        </button>
      ))}
    </form>
  );
}
