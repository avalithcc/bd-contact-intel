/**
 * Curated, accent-insensitive list of common Spanish/Portuguese given names
 * (owner ask, 2026-09-30) — used by stuffedNameFirstTokenSplit.ts's
 * "compound given name" rule: when the SECOND token of an otherwise-
 * ambiguous name is a common given name, it belongs to the first name
 * ("Maria Sol Gonzalez" -> "Maria Sol" / "Gonzalez"). This is the owner's
 * explicit minimum list, PLUS "damian" — required by the owner's own worked
 * LinkedIn-cleanup example in the same request ("Hector Damian Lema" ->
 * "Hector Damian" / "Lema" via this rule), which is not resolvable without
 * it. Deliberately does NOT include "vicente": it appears as a SURNAME in
 * the production sample "Alicia Vicente Andrés", so including it would
 * wrongly widen that split. Extend only after another owner review of the
 * actual row — never by guessing at a broader dictionary, same convention
 * as stuffedNameSplitBackfill.ts#COMPANY_SUFFIX_WORDS.
 */
export const COMMON_GIVEN_NAMES: ReadonlySet<string> = new Set([
  "sol",
  "florencia",
  "andres",
  "fernando",
  "alexis",
  "nicolas",
  "guillermo",
  "omar",
  "manuel",
  "pablo",
  "paulo",
  "andre",
  "jose",
  "maria",
  "juan",
  "luis",
  "carlos",
  "ana",
  "laura",
  "lucia",
  "belen",
  "jesus",
  "antonio",
  "alejandro",
  "martin",
  "ignacio",
  "agustin",
  "sebastian",
  "gabriel",
  "daniel",
  "david",
  "eduardo",
  "emilio",
  "esteban",
  "federico",
  "francisco",
  "gonzalo",
  "javier",
  "jorge",
  "julian",
  "leandro",
  "lorena",
  "marcela",
  "matias",
  "miguel",
  "pedro",
  "rafael",
  "ramon",
  "ricardo",
  "roberto",
  "rodrigo",
  "santiago",
  "sergio",
  "tomas",
  "valentina",
  "victoria",
  // Not in the owner's minimum list — added because the owner's own
  // "Hector Damian Lema" worked example requires it (see doc comment above).
  "damian",
]);

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Accent-insensitive, case-insensitive membership check against
 * `COMMON_GIVEN_NAMES`. */
export function isCommonGivenName(token: string): boolean {
  return COMMON_GIVEN_NAMES.has(stripDiacritics(token).toLowerCase());
}
