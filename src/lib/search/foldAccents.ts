/**
 * JS twin of the accent-insensitive search rule documented in ./accentInsensitive.ts. Drizzle-free on purpose, so a
 * client component can import it. `foldedIncludes(text, term)` must return the same verdict as the SQL
 * `unaccent(text) ilike unaccent('%' || escaped(term) || '%')`; tests/db/accentInsensitiveSearch.test.ts proves it.
 */
/** Letters Unicode decomposition leaves alone but Postgres `unaccent` folds (same targets as its rules file). */
const LATIN_EXTRAS: Readonly<Record<string, string>> = {
  ß: "ss", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE", ø: "o", Ø: "O", ł: "l", Ł: "L", đ: "d", Đ: "D",
};
const EXTRAS_RE = new RegExp(`[${Object.keys(LATIN_EXTRAS).join("")}]`, "g");

/**
 * Removes accents. Uses `\p{M}` (combining marks), NOT `\p{Diacritic}`: the latter also matches ASCII `^` and `` ` ``,
 * which `unaccent` leaves alone.
 */
export function foldAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(EXTRAS_RE, (ch) => LATIN_EXTRAS[ch]);
}

/** JS twin of `termContainsSql`: does `text` contain `term`, ignoring case and accents. `%` and `_` are literal here too. */
export function foldedIncludes(text: string | null | undefined, term: string): boolean {
  if (text == null) return false;
  return foldAccents(text).toLowerCase().includes(foldAccents(term).toLowerCase());
}
