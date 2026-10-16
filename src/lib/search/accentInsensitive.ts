/**
 * THE search rule for the whole app: a term matches a text when the text CONTAINS the term, ignoring case AND accents
 * on both sides. Typing "jose" finds JOSE, Jose and José; typing "José" finds jose; "pena" finds Peña.
 *
 * Why it exists: `ilike` folds case only. `'José' ilike '%jose%'` is false in Postgres, which in an Argentine contact
 * base (Pérez, Gómez, Núñez, Peña, Sebastián) made searches silently miss people. Every search site goes through
 * this module so the sites can never drift apart, the same way `effectiveActivityAtSql` serves the activity-time sites.
 *
 * SQL side: `unaccent(column) ilike (select unaccent(pattern))` (extension installed by migration 0046). Both sides are folded,
 * so the column and the typed text always meet in the same alphabet. JS side (`foldedIncludes`): the twin used by the
 * in-memory filters, pinned to the SQL by tests/db/accentInsensitiveSearch.test.ts over the shared ACCENT_CASES.
 *
 * Wildcards: a user's `%`, `_` and `\` are escaped (`escapeLikeWildcards`) so they are literal characters, never
 * LIKE wildcards. Patterns that intentionally carry wildcards (a hand-built `prefix/%/%slug%`) use `foldedIlikeRawPattern`
 * and escape the user part themselves.
 *
 * Known JS/SQL gap: JS folds with Unicode decomposition (NFD, drop combining marks) plus a small table for letters
 * that do not decompose. Postgres `unaccent` has a longer rules file (Greek, Cyrillic-adjacent, symbols such as
 * "©" or "½"). Both agree on every Latin letter used in Spanish, Portuguese, French, German and the Nordic/Polish
 * letters in LATIN_EXTRAS; outside that set the SQL may fold more than JS does. The JS filters only run over
 * already-loaded rows, so the gap can only make a JS filter stricter, never wrong in the other direction.
 */
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

// The JS twin lives in its own drizzle-free file so client components can import it without bundling the ORM.
export { foldAccents, foldedIncludes } from "@/lib/search/foldAccents";

const LIKE_WILDCARD_RE = /[%_\\]/g;

/** A user's `%`, `_` and `\` become literal characters inside a LIKE/ILIKE pattern. */
export function escapeLikeWildcards(value: string): string {
  return value.replace(LIKE_WILDCARD_RE, (ch) => `\\${ch}`);
}

/** `%term%` with the user's wildcards escaped. */
export function containsPattern(term: string): string {
  return `%${escapeLikeWildcards(term)}%`;
}

/**
 * SQL: `unaccent(column) ilike (select unaccent(pattern))`. The pattern is used EXACTLY as given — this escapes
 * nothing. Only for a hand-built pattern that carries intentional wildcards, with the user's part already escaped by
 * the caller (`escapeLikeWildcards`). For user-typed search text use `termContainsSql`, never this. The name says
 * "raw" so a careless caller has to read it before passing user input through.
 *
 * Why the pattern sits in a scalar subquery: `unaccent` is STABLE, not IMMUTABLE, so Postgres does not fold
 * `unaccent($1)` at plan time and re-evaluates it for EVERY row the Seq Scan filters. `(select unaccent($1))` is
 * uncorrelated, so it becomes an InitPlan evaluated once per statement. Measured on production 2026-10-16, contact
 * search for "jose" over 27k rows: 71 ms with plain ilike (367 rows), 110 ms with unaccent on both sides, 91 ms with
 * this shape (594 rows). The column side still folds per row; only an index would remove that, and none is needed at
 * this size.
 */
export function foldedIlikeRawPattern(column: SQLWrapper, pattern: string): SQL {
  return sql`unaccent(${column}) ilike (select unaccent(${pattern}))`;
}

/** SQL: does `column` contain the user's `term`, ignoring case and accents. The default for every search site. */
export function termContainsSql(column: SQLWrapper, term: string): SQL {
  return foldedIlikeRawPattern(column, containsPattern(term));
}
