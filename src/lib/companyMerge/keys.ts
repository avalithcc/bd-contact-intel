/**
 * Shared vocabulary of the company-merge tooling: which tables carry a
 * `company_key`, the one key builder for per-table reference counts, and the
 * squash used to PROPOSE (never to decide) duplicate candidates.
 */

/** Every table with a `company_key` column. A test fails when the schema and this list drift apart. */
export const COMPANY_KEY_TABLES = [
  "activity",
  "board_candidate",
  "company",
  "company_alias",
  "company_probe",
  "company_property_history",
  "contact",
  "job_posting",
  "lead",
  "person",
  "signal",
  "sync_run",
  "target_company",
  "task",
] as const;

/** Key of the reference-count map: the producer (buildRefCounts) and every reader go through these two. */
export const refKey = (table: string, companyKey: string): string => `${table}|${companyKey}`;

/** Raw rows of the per-table count query: counts arrive as numbers or strings depending on the driver path. */
export function buildRefCounts(rows: readonly { t: string; k: string; n: number | string }[]): Map<string, number> {
  return new Map(rows.map((r) => [refKey(r.t, r.k), Number(r.n)]));
}

export const refCount = (counts: ReadonlyMap<string, number>, table: string, companyKey: string): number =>
  counts.get(refKey(table, companyKey)) ?? 0;

/**
 * Same squash as the SQL `regexp_replace(lower(company_key), '[^a-z0-9]', '', 'g')`. A HEURISTIC: `&company` and
 * `Company` squash alike and are different companies, so it may only propose candidates for a human to confirm.
 */
export const squashCompanyKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");
