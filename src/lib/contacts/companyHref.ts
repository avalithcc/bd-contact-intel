/**
 * Href for a Contact's employer name, or null when it must render as plain
 * text. `person.company_key` has no FK to `company`: the fi-arg-2026 and
 * contactos-comerciales-2026-10 importers wrote the key without creating the
 * company, so a key alone does not prove `/companies/{key}` exists (314 live
 * contacts in production, measured read-only 2026-10-09). The caller passes
 * whether its `getCompanyByKey` read found a row, so linking costs no extra
 * query. The employer text itself still lives in `person.company` and renders
 * fine without a link. Pure — no DB.
 */
export function companyHref(companyKey: string | null | undefined, companyExists: boolean): string | null {
  if (!companyKey || !companyExists) return null;
  return `/companies/${encodeURIComponent(companyKey)}`;
}
