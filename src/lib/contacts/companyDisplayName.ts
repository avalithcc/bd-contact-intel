/**
 * "Empresa" display-name resolution (bug fix, owner report: the `/contacts`
 * list's Empresa column reads only `person.company`, the free-text field —
 * null on 7,132 production contacts, ~5,790 of which DO resolve through
 * `person.company_key` -> `company.display_name`). Pure, DB-free logic
 * split out of `listQueries.ts` so it's unit-testable without `@/db`, and
 * shared by every render path (list table, board, CSV export, outreach
 * view, Contact record) so they can never disagree on which name to show.
 *
 * Rule (explicit, not a judgment call): free text wins when present. Do NOT
 * prefer the canonical `company.display_name` over a non-null
 * `person.company` — that would change what ~19,000 contacts with a
 * non-null free text currently display, a much bigger change than filling
 * the 5,790 blanks that were actually asked for. The canonical name is
 * fallback-only, for the null case.
 */

/** One person's company display value: free text first, canonical name
 * second, `null` when neither is on file (no `company_key`, or a
 * `company_key` with no matching `company` row — `person.company_key` is
 * not a foreign key). */
export function resolveCompanyDisplayName(
  freeText: string | null | undefined,
  canonicalDisplayName: string | null | undefined,
): string | null {
  return freeText ?? canonicalDisplayName ?? null;
}

/** Row shape any raw-SQL read joins `company` into: the free-text
 * `company` column plus the joined `company.display_name`, exposed under a
 * distinct key (`companyCanonicalName`) so both values are available to
 * resolve from and neither is silently lost before resolution runs. */
export interface RowWithCompanyCanonicalName {
  company: string | null;
  companyCanonicalName: string | null;
}

/**
 * Resolves `company` on every row via `resolveCompanyDisplayName` and drops
 * `companyCanonicalName` (a join-only field, never part of the public row
 * shape). Pure: clones each row, never mutates `rows` or its elements — two
 * calls with the same input return equal results.
 */
export function withResolvedCompanyName<T extends RowWithCompanyCanonicalName>(
  rows: T[],
): Omit<T, "companyCanonicalName">[] {
  return rows.map((row) => {
    const { companyCanonicalName, ...rest } = row;
    return { ...rest, company: resolveCompanyDisplayName(row.company, companyCanonicalName) };
  });
}

/**
 * Does the name this row DISPLAYS contain `term`?
 *
 * The authoritative rule for the "Empresa" ad-hoc filter and the global
 * search box, kept here beside `resolveCompanyDisplayName` because it must
 * agree with it case by case: a row matches a company term if and only if
 * the name a BD can actually see on that row matches it.
 * `listQueries.ts#companyNameMatchCondition` is the SQL translation of this
 * function — change one and the other is wrong.
 *
 * Why not simply OR both columns: free text wins the display, so a contact
 * whose free text says "Acme" while its `company_key` resolves to "Nubiral"
 * (225 in production) must NOT come back for "nubiral", or the list would
 * return a row whose Empresa cell shows an unrelated name.
 */
export function companyNameMatchesTerm(
  freeText: string | null | undefined,
  canonicalDisplayName: string | null | undefined,
  term: string,
): boolean {
  // `|| null` and not `?? null`: an empty free-text string is "absent" for
  // matching, exactly as the SQL's `(company is null or company = '')` guard
  // treats it, so a blank import value still falls through to the canonical
  // name instead of matching nothing.
  //
  // Whitespace-only free text ("   ") is deliberately NOT trimmed here: the
  // SQL guard is `company = ''`, so trimming on this side only would make
  // the two disagree. Zero production rows are in that shape today (checked);
  // if that changes, BOTH sides move together or neither does.
  const displayed = resolveCompanyDisplayName(freeText || null, canonicalDisplayName);
  if (displayed === null) return false;
  return displayed.toLowerCase().includes(term.toLowerCase());
}
